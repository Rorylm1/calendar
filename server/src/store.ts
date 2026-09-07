import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Vault, hash } from './crypto.ts';
import { AppError, ProcessingPaused } from './errors.ts';
import { confirmedFields, mergeFields, type CalendarEvent, type Fields, type Proposal, type SourceMessage, type EventPatch } from './domain.ts';
import type { z } from 'zod';

export type SourceStatus = 'fetched' | 'processing' | 'processed' | 'filtered' | 'failed';
export class Store {
  readonly db: DatabaseSync;
  readonly vault: Vault;
  constructor(path: string, key: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path); this.vault = new Vault(key);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(bucket TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(bucket,id));
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, status TEXT NOT NULL, captured_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT, attempts INTEGER NOT NULL DEFAULT 0, audit TEXT, next_attempt_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS fingerprints(fingerprint TEXT PRIMARY KEY,proposal_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,month TEXT NOT NULL,cost REAL NOT NULL,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,payload TEXT NOT NULL);
      UPDATE sources SET status='fetched' WHERE status='processing';`);
    if (!(this.db.prepare('PRAGMA table_info(sources)').all() as { name: string }[]).some(column => column.name === 'next_attempt_at')) this.db.exec('ALTER TABLE sources ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0');
  }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  get<T>(bucket: string, id = 'default'): T | undefined {
    const row = this.db.prepare('SELECT payload FROM records WHERE bucket=? AND id=?').get(bucket, id) as { payload: string } | undefined;
    return row ? this.vault.open<T>(row.payload, `${bucket}:${id}`) : undefined;
  }
  put(bucket: string, id: string, value: unknown) { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET payload=excluded.payload').run(bucket, id, this.vault.seal(value, `${bucket}:${id}`)); }
  remove(bucket: string, id = 'default') { this.db.prepare('DELETE FROM records WHERE bucket=? AND id=?').run(bucket, id); }
  all<T>(bucket: string): T[] { return (this.db.prepare('SELECT id,payload FROM records WHERE bucket=?').all(bucket) as { id: string; payload: string }[]).map(row => this.vault.open<T>(row.payload, `${bucket}:${row.id}`)); }
  events() { return this.all<CalendarEvent>('events').sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`)); }
  proposals() { return this.all<Proposal>('proposals'); }
  createEvent(fields: Fields, source: CalendarEvent['source'] = 'Manual'): CalendarEvent {
    const event: CalendarEvent = { ...confirmedFields(fields), id: randomUUID(), source, revision: 1 }; this.put('events', event.id, event); return event;
  }
  patchEvent(id: string, patch: z.infer<typeof EventPatch>, revision: number): CalendarEvent {
    return this.transaction(() => { const old = this.requireEvent(id, revision); const { id: _, source, revision: __, ...fields } = old;
      const event: CalendarEvent = { ...confirmedFields(mergeFields(fields, patch)), id, source, revision: old.revision + 1 }; this.put('events', id, event); return event; });
  }
  deleteEvent(id: string, revision: number) {
    this.transaction(() => { this.requireEvent(id, revision); this.remove('events', id); this.put('deleted_events', id, { revision: revision + 1, deletedAt: new Date().toISOString() }); });
  }
  requireEvent(id: string, revision?: number): CalendarEvent {
    const event = this.get<CalendarEvent>('events', id); if (!event) throw new AppError('not_found', 'This event is no longer available.', 404);
    if (revision !== undefined && event.revision !== revision) throw new AppError('revision_conflict', 'This event has changed. Refresh and review it again.', 409); return event;
  }
  putProposal(input: Omit<Proposal, 'id' | 'createdAt' | 'revision' | 'status'>): Proposal | undefined {
    const fingerprint = hash(JSON.stringify({ action: input.action, target: input.targetEventId, targetRevision: input.targetRevision, event: input.event, attendance: input.attendance, unresolved: input.unresolvedFields, missingDateSource: input.event.date ? undefined : input.sourceMessageIds }));
    const known = this.db.prepare('SELECT proposal_id FROM fingerprints WHERE fingerprint=?').get(fingerprint) as { proposal_id: string } | undefined;
    if (known) {
      const proposal = this.get<Proposal>('proposals', known.proposal_id);
      if (proposal) { proposal.sourceMessageIds = [...new Set([...proposal.sourceMessageIds, ...input.sourceMessageIds])]; this.put('proposals', proposal.id, proposal); }
      return undefined;
    }
    const proposal: Proposal = { ...input, id: randomUUID(), status: 'pending', revision: 1, createdAt: new Date().toISOString() };
    this.put('proposals', proposal.id, proposal); this.db.prepare('INSERT INTO fingerprints VALUES(?,?)').run(fingerprint, proposal.id); return proposal;
  }
  confirm(id: string, patch: z.infer<typeof EventPatch> = {}, expectedRevision?: number): { proposal: Proposal; event: CalendarEvent | null } {
    return this.transaction(() => {
      const proposal = this.get<Proposal>('proposals', id); if (!proposal) throw new AppError('not_found', 'This suggestion is no longer available.', 404);
      if (proposal.status === 'confirmed') return this.get<{ proposal: Proposal; event: CalendarEvent | null }>('confirm_results', id)!;
      if (proposal.status !== 'pending') throw new AppError('review_conflict', 'This suggestion was dismissed.', 409);
      let event: CalendarEvent | null = null;
      if (proposal.action === 'create') { event = this.createEvent(mergeFields(proposal.event, patch), 'Gmail'); }
      else {
        if (!proposal.targetEventId || proposal.targetRevision === undefined) throw new AppError('review_conflict', 'Choose the existing event before applying this change.', 409);
        const old = this.requireEvent(proposal.targetEventId, proposal.targetRevision);
        if (expectedRevision !== undefined && expectedRevision !== old.revision) throw new AppError('revision_conflict', 'This event has changed. Refresh and review it again.', 409);
        if (proposal.action === 'cancel') { this.remove('events', old.id); this.put('deleted_events', old.id, { revision: old.revision + 1, deletedAt: new Date().toISOString() }); }
        else { event = { ...confirmedFields(mergeFields(proposal.event, patch)), id: old.id, source: old.source, revision: old.revision + 1 }; this.put('events', old.id, event); }
      }
      proposal.status = 'confirmed'; proposal.revision += 1;
      if (proposal.action !== 'cancel') proposal.attendance = 'confirmed';
      this.put('proposals', id, proposal); const result = { proposal, event }; this.put('confirm_results', id, result); return result;
    });
  }
  dismiss(id: string): Proposal { return this.transaction(() => { const proposal = this.get<Proposal>('proposals', id); if (!proposal) throw new AppError('not_found', 'This suggestion is no longer available.', 404); if (proposal.status === 'confirmed') throw new AppError('review_conflict', 'This suggestion has already been confirmed.', 409); if (proposal.status === 'pending') { proposal.status = 'dismissed'; proposal.revision += 1; this.put('proposals', id, proposal); } return proposal; }); }
  captured(id: string) { return Boolean(this.db.prepare('SELECT 1 FROM sources WHERE id=?').get(id)); }
  capture(source: SourceMessage) { const now = new Date().toISOString(); this.db.prepare('INSERT OR IGNORE INTO sources(id,status,captured_at,updated_at,payload) VALUES(?,?,?,?,?)').run(source.id, 'fetched', now, now, this.vault.seal(source, `source:${source.id}`)); }
  skipSource(id: string) { const now = new Date().toISOString(); this.db.prepare('INSERT OR IGNORE INTO sources(id,status,captured_at,updated_at) VALUES(?,?,?,?)').run(id, 'filtered', now, now); }
  pending(limit = 40, now = Date.now()): SourceMessage[] { return (this.db.prepare("SELECT id,payload FROM sources WHERE payload IS NOT NULL AND (status='fetched' OR (status='failed' AND attempts<3 AND next_attempt_at<=?)) ORDER BY CASE status WHEN 'fetched' THEN 0 ELSE 1 END,captured_at LIMIT ?").all(now, limit) as { id: string; payload: string }[]).map(row => this.vault.open<SourceMessage>(row.payload, `source:${row.id}`)); }
  sourceStatus(id: string, status: SourceStatus, audit?: unknown) { this.db.prepare("UPDATE sources SET attempts=attempts+CASE WHEN ?='processing' AND status!='processing' THEN 1 ELSE 0 END,status=?,updated_at=?,next_attempt_at=CASE WHEN ?='failed' THEN ?+MIN(14400000,1800000*(1 << MIN(attempts,3))) ELSE next_attempt_at END,audit=COALESCE(?,audit) WHERE id=?").run(status, status, new Date().toISOString(), status, Date.now(), audit ? this.vault.seal(audit, `audit:${id}`) : null, id); }
  retryFailures() { this.db.exec("UPDATE sources SET status='fetched',attempts=0,next_attempt_at=0 WHERE status='failed' AND payload IS NOT NULL"); }
  counts() { const count = { pendingMessages: 0, capturedMessages: 0, filteredMessages: 0, failedMessages: 0 }; for (const row of this.db.prepare('SELECT status,COUNT(*) n FROM sources GROUP BY status').all() as { status: SourceStatus; n: number }[]) { count.capturedMessages += row.n; if (['fetched', 'processing', 'failed'].includes(row.status)) count.pendingMessages += row.n; if (row.status === 'filtered') count.filteredMessages += row.n; if (row.status === 'failed') count.failedMessages += row.n; } return count; }
  pruneSources(now = Date.now()) {
    const cutoff = new Date(now - 14 * 86400000).toISOString();
    for (const row of this.db.prepare("SELECT id FROM sources WHERE status IN ('processed','filtered') AND captured_at<? AND (payload IS NOT NULL OR audit IS NOT NULL)").all(cutoff) as { id: string }[]) this.remove('triage', row.id);
    this.db.prepare("UPDATE sources SET payload=NULL,audit=NULL WHERE status IN ('processed','filtered') AND captured_at < ?").run(cutoff); this.db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(now);
  }
  clearSources() { this.db.exec('DELETE FROM sources'); }
  audit(limit = 50) { return (this.db.prepare('SELECT id,status,audit FROM sources WHERE audit IS NOT NULL ORDER BY updated_at DESC LIMIT ?').all(limit) as { id: string; status: string; audit: string }[]).map(row => ({ id: row.id, status: row.status, ...this.vault.open<{ decision?: string; reason?: string; excerpt?: string; subject?: string }>(row.audit, `audit:${row.id}`) })); }
  createOAuthState(state: string, ownerId: string, verifier: string, now = Date.now()) { const key = hash(state); this.db.prepare('INSERT INTO oauth_states VALUES(?,?,?)').run(key, now + 10 * 60000, this.vault.seal({ ownerId, verifier }, `oauth:${key}`)); }
  consumeOAuthState(state: string, ownerId: string, now = Date.now()): string {
    return this.transaction(() => { const key = hash(state); const row = this.db.prepare('SELECT expires_at,payload FROM oauth_states WHERE hash=?').get(key) as { expires_at: number; payload: string } | undefined;
      if (!row || row.expires_at < now) throw new AppError('invalid_state', 'This connection link has expired. Start again.', 400);
      const payload = this.vault.open<{ ownerId: string; verifier: string }>(row.payload, `oauth:${key}`); if (payload.ownerId !== ownerId) throw new AppError('invalid_state', 'This connection belongs to another session. Start again.', 400);
      this.db.prepare('DELETE FROM oauth_states WHERE hash=?').run(key); return payload.verifier; });
  }
  spend(month = new Date().toISOString().slice(0, 7)): number { return Number((this.db.prepare('SELECT COALESCE(SUM(cost),0) amount FROM usage WHERE month=?').get(month) as { amount: number }).amount); }
  reserve(cost: number, budget: number): string { return this.transaction(() => { if (this.spend() + cost > budget) throw new ProcessingPaused('paused_budget'); const id = randomUUID(); this.db.prepare('INSERT INTO usage VALUES(?,?,?,?)').run(id, new Date().toISOString().slice(0, 7), cost, 'reserved'); return id; }); }
  settleUsage(id: string, cost: number) { this.db.prepare("UPDATE usage SET cost=?,status='settled' WHERE id=?").run(cost, id); }
  close() { this.db.close(); }
}
