import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Vault, hash } from './crypto.ts';
import { AppError, ProcessingPaused } from './errors.ts';
import { confirmedFields, mergeFields, type CalendarEvent, type Fields, type Proposal, type SourceMessage, type EventPatch } from './domain.ts';
import type { z } from 'zod';

export type SourceStatus = 'fetched' | 'processing' | 'processed' | 'filtered' | 'failed';
export type EventExportMetadata = { revision: number; createdAt: string; modifiedAt: string };
type AutomationMetadata = { baseline: Fields; ownerFields: string[]; managed: boolean; identities?: Fields[]; lastSourceAt?: string; sourceThreads?: string[] };
export type AutoApplySummary = { created: number; updated: number; cancelled: number; duplicate: number; suppressed: number; needsDetails: number };
const eventFields = ({ id: _id, source: _source, revision: _revision, ...fields }: CalendarEvent): Fields => fields;
const normalized = (value?: string) => (value || '').replace(/^\s*(?:invitation\s*:\s*)+/i, '').trim().replace(/\s+/g, ' ').toLowerCase();
function sameBooking(a: Fields, b: Fields, compareTime = true): boolean {
  if (!a.date || a.date !== b.date || a.kind !== b.kind || (compareTime && a.time !== b.time)) return false;
  if (a.reference && b.reference && normalized(a.reference) !== normalized(b.reference)) return false;
  if (a.location && b.location && normalized(a.location) !== normalized(b.location)) return false;
  if (a.timeZone && b.timeZone && a.timeZone !== b.timeZone) return false;
  const referenceMatch = a.reference && b.reference && normalized(a.reference) === normalized(b.reference);
  return normalized(a.title) === normalized(b.title) || Boolean(referenceMatch && normalized(a.location) && normalized(a.location) === normalized(b.location));
}
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function compatibleIdentity(existing: Fields, candidate: Fields): boolean {
  return ['title', 'date', 'time', 'endDate', 'endTime', 'kind', 'location', 'reference', 'timeZone', 'endTimeZone'].every(key => {
    const a = existing[key as keyof Fields]; const b = candidate[key as keyof Fields];
    return !a || !b || normalized(String(a)) === normalized(String(b));
  });
}
// Absent optional facts do not erase previously known booking details.
function suppliedFields(base: Fields, next: Fields): Fields {
  const merged = { ...base };
  for (const [key, value] of Object.entries(next)) if (value !== undefined && value !== '' && key !== 'reminderMinutes' && key !== 'attendance') (merged as Record<string, unknown>)[key] = value;
  return merged;
}
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
  all<T>(bucket: string): T[] { return (this.db.prepare('SELECT id,payload FROM records WHERE bucket=? ORDER BY rowid').all(bucket) as { id: string; payload: string }[]).map(row => this.vault.open<T>(row.payload, `${bucket}:${row.id}`)); }
  events() { return this.all<CalendarEvent>('events').map(event => ({ ...event, attendance: event.attendance || 'confirmed' as const })).sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`)); }
  proposals() { return this.all<Proposal>('proposals'); }
  eventExportMetadata(event: CalendarEvent, now = Date.now()): EventExportMetadata {
    const old = this.get<EventExportMetadata>('event_export_metadata', event.id);
    if (old?.revision === event.revision) return old;
    // Existing calendars receive a stable first-export timestamp once. New
    // mutations write this metadata in the same transaction as the event.
    const modifiedAt = new Date(Math.max(now, old ? Date.parse(old.modifiedAt) : 0)).toISOString();
    const metadata = { revision: event.revision, createdAt: old?.createdAt || modifiedAt, modifiedAt };
    this.put('event_export_metadata', event.id, metadata); return metadata;
  }
  private saveEvent(event: CalendarEvent) { this.put('events', event.id, event); this.eventExportMetadata(event); }
  createEvent(fields: Fields, source: CalendarEvent['source'] = 'Manual'): CalendarEvent {
    const write = () => { const event: CalendarEvent = { ...confirmedFields(fields), attendance: fields.attendance || 'confirmed', id: randomUUID(), source, revision: 1 }; this.saveEvent(event); this.put('event_automation', event.id, { baseline: eventFields(event), ownerFields: [], managed: false } satisfies AutomationMetadata); return event; };
    return this.db.isTransaction ? write() : this.transaction(write);
  }
  patchEvent(id: string, patch: z.infer<typeof EventPatch>, revision: number): CalendarEvent {
    return this.transaction(() => { const old = this.requireEvent(id, revision); const { id: _, source, revision: __, ...fields } = old;
      const event: CalendarEvent = { ...confirmedFields(mergeFields(fields, patch)), id, source, revision: old.revision + 1 }; this.saveEvent(event);
      const metadata = this.get<AutomationMetadata>('event_automation', id) || { baseline: fields, ownerFields: [], managed: false };
      metadata.ownerFields = [...new Set([...metadata.ownerFields, ...Object.keys(patch).filter(key => key === 'attendance' || !sameValue(fields[key as keyof Fields], event[key as keyof Fields]))])]; this.put('event_automation', id, metadata); return event; });
  }
  deleteEvent(id: string, revision: number) {
    this.transaction(() => { this.removeEvent(this.requireEvent(id, revision)); });
  }
  private removeEvent(event: CalendarEvent) { this.remove('events', event.id); this.put('deleted_events', event.id, { event, baseline: this.get<AutomationMetadata>('event_automation', event.id)?.baseline, revision: event.revision + 1, deletedAt: new Date().toISOString() }); }
  requireEvent(id: string, revision?: number): CalendarEvent {
    const event = this.get<CalendarEvent>('events', id); if (!event) throw new AppError('not_found', 'This event is no longer available.', 404);
    if (revision !== undefined && event.revision !== revision) throw new AppError('revision_conflict', 'This event has changed. Refresh and review it again.', 409); return { ...event, attendance: event.attendance || 'confirmed' };
  }
  putProposal(input: Omit<Proposal, 'id' | 'createdAt' | 'revision' | 'status'>): Proposal | undefined {
    const fingerprint = hash(JSON.stringify({ action: input.action, target: input.targetEventId, targetRevision: input.targetRevision, event: input.event, attendance: input.attendance, unresolved: input.unresolvedFields, missingDateSource: input.event.date ? undefined : input.sourceMessageIds }));
    const known = this.db.prepare('SELECT proposal_id FROM fingerprints WHERE fingerprint=?').get(fingerprint) as { proposal_id: string } | undefined;
    if (known) {
      const proposal = this.get<Proposal>('proposals', known.proposal_id);
      if (proposal) {
        proposal.sourceMessageIds = [...new Set([...proposal.sourceMessageIds, ...input.sourceMessageIds])]; this.put('proposals', proposal.id, proposal);
        const applied = this.get<{ event: CalendarEvent | null }>('confirm_results', proposal.id)?.event;
        const current = applied && this.get<CalendarEvent>('events', applied.id); const metadata = current && this.get<AutomationMetadata>('event_automation', current.id);
        if (proposal.status === 'confirmed' && current && metadata?.managed && compatibleIdentity(current, input.event)) { this.recordSources(metadata, input.sourceMessageIds); this.put('event_automation', current.id, metadata); }
      }
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
      if (proposal.action === 'create') { event = this.createEvent(mergeFields({ ...proposal.event, attendance: proposal.attendance === 'confirmed' ? 'confirmed' : 'invited' }, patch), 'Gmail'); }
      else {
        if (!proposal.targetEventId || proposal.targetRevision === undefined) throw new AppError('review_conflict', 'Choose the existing event before applying this change.', 409);
        const old = this.requireEvent(proposal.targetEventId, proposal.targetRevision);
        if (expectedRevision !== undefined && expectedRevision !== old.revision) throw new AppError('revision_conflict', 'This event has changed. Refresh and review it again.', 409);
        if (proposal.action === 'cancel') this.removeEvent(old);
        else { event = { ...confirmedFields(mergeFields({ ...suppliedFields(eventFields(old), proposal.event), attendance: old.attendance === 'confirmed' || proposal.attendance === 'confirmed' ? 'confirmed' : 'invited' }, patch)), id: old.id, source: old.source, revision: old.revision + 1 }; this.saveEvent(event); }
      }
      if (event) {
        const prior = this.get<AutomationMetadata>('event_automation', event.id);
        const changed = Object.keys(patch).filter(key => key === 'attendance' || !sameValue(proposal.event[key as keyof Fields], event![key as keyof Fields]));
        const metadata: AutomationMetadata = { ...prior, baseline: eventFields(event), managed: proposal.action === 'create' || prior?.managed === true, ownerFields: [...new Set([...(prior?.ownerFields || []), ...changed])], identities: [...(prior?.identities || []), eventFields(event)] }; this.recordSources(metadata, proposal.sourceMessageIds); this.put('event_automation', event.id, metadata);
      }
      return this.finishProposal(proposal, event, 'owner', proposal.action === 'create' ? 'created' : proposal.action === 'update' ? 'updated' : 'cancelled');
    });
  }
  private finishProposal(proposal: Proposal, event: CalendarEvent | null, appliedBy: 'automatic' | 'owner', outcome: NonNullable<Proposal['outcome']>) {
    proposal.status = outcome === 'suppressed' ? 'dismissed' : 'confirmed'; proposal.revision += 1;
    proposal.appliedBy = appliedBy; proposal.appliedAt = new Date().toISOString(); proposal.outcome = outcome;
    this.put('proposals', proposal.id, proposal); const result = { proposal, event }; this.put('confirm_results', proposal.id, result); return result;
  }
  private sourceProvenance(ids: string[]) {
    const sources = ids.flatMap(id => {
      const row = this.db.prepare('SELECT payload FROM sources WHERE id=?').get(id) as { payload: string | null } | undefined;
      return row?.payload ? [this.vault.open<SourceMessage>(row.payload, `source:${id}`)] : [];
    });
    return { sourceAt: sources.flatMap(source => [source.receivedAt, ...source.context.map(reply => reply.sentAt)]).filter(value => Number.isFinite(Date.parse(value))).map(value => new Date(value).toISOString()).sort().at(-1), sourceThreads: [...new Set(sources.map(source => source.threadId))] };
  }
  private recordSources(metadata: AutomationMetadata, ids: string[]) {
    const { sourceAt, sourceThreads } = this.sourceProvenance(ids);
    if (sourceAt && (!metadata.lastSourceAt || sourceAt > metadata.lastSourceAt)) metadata.lastSourceAt = sourceAt;
    metadata.sourceThreads = [...new Set([...(metadata.sourceThreads || []), ...sourceThreads])];
  }
  /** Applies only already captured, evidence-checked proposals. No provider or model calls.
   * Dry runs execute the same mutations inside a rolled-back savepoint, including
   * cross-proposal deduplication, and return counts without any private content. */
  autoApplyPending(options: { dryRun?: boolean; proposalIds?: string[] } = {}): AutoApplySummary {
    const run = () => {
      const counts: AutoApplySummary = { created: 0, updated: 0, cancelled: 0, duplicate: 0, suppressed: 0, needsDetails: 0 };
      const selected = options.proposalIds ? new Set(options.proposalIds) : undefined;
      for (const proposal of this.proposals().filter(item => item.status === 'pending' && (!selected || selected.has(item.id))).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) counts[this.applyAutomatically(proposal)]++;
      return counts;
    };
    const write = () => {
      if (!options.dryRun) return run();
      this.db.exec('SAVEPOINT automatic_calendar_preview');
      try { return run(); } finally { this.db.exec('ROLLBACK TO automatic_calendar_preview; RELEASE automatic_calendar_preview'); }
    };
    return this.db.isTransaction ? write() : this.transaction(write);
  }
  private applyAutomatically(proposal: Proposal): keyof AutoApplySummary {
    const needs = (field?: string): 'needsDetails' => {
      if (field && !proposal.unresolvedFields.includes(field)) { proposal.unresolvedFields.push(field); proposal.revision++; this.put('proposals', proposal.id, proposal); }
      return 'needsDetails';
    };
    const finish = (event: CalendarEvent | null, outcome: NonNullable<Proposal['outcome']>): keyof AutoApplySummary => { this.finishProposal(proposal, event, 'automatic', outcome); return outcome; };
    if (!proposal.evidence.some(excerpt => excerpt.trim().length > 2) || !proposal.sourceMessageIds.length) return needs('evidence');
    if (proposal.action === 'create' && proposal.attendance === 'declined') return finish(null, 'suppressed');
    // Attendance and absent optional clock/zone values are representable. Factual
    // ambiguity, unsupported attachments and missing targets require owner input.
    const optional: Record<string, keyof Fields | null> = { attendance: null, rsvp: null, confirmation: null, time: 'time', starttime: 'time', endtime: 'endTime', timezone: 'timeZone', endtimezone: 'endTimeZone', location: 'location', reference: 'reference', enddate: 'endDate' };
    if (proposal.unresolvedFields.some(field => { const key = field.replace(/[ _-]/g, '').toLowerCase(); return !Object.hasOwn(optional, key) || optional[key] !== null && proposal.event[optional[key]!] !== undefined && proposal.event[optional[key]!] !== ''; })) return needs();
    const attendance: 'confirmed' | 'invited' = proposal.attendance === 'confirmed' ? 'confirmed' : 'invited';
    const { sourceAt, sourceThreads } = this.sourceProvenance(proposal.sourceMessageIds);
    const recordSource = (metadata: AutomationMetadata) => this.recordSources(metadata, proposal.sourceMessageIds);
    const complete = (fields: Fields) => {
      // The product's explicit fallback is London. Validate that fallback too so
      // nonexistent/ambiguous DST times cannot silently enter the subscribed feed.
      confirmedFields({ ...fields, ...(fields.time || fields.endTime ? { timeZone: fields.timeZone || 'Europe/London' } : {}) });
      return confirmedFields(fields);
    };
    const suppressed = this.proposals().some(old => old.id !== proposal.id && old.status === 'dismissed' && (
      proposal.action === 'create' && old.action === 'create' && sameBooking(old.event, proposal.event, false) ||
      proposal.action !== 'create' && old.action === proposal.action && old.targetEventId === proposal.targetEventId && sameValue(old.event, proposal.event)
    ));
    if (suppressed) return finish(null, 'suppressed');
    if (proposal.action === 'create') {
      if (!proposal.event.date) return needs('date');
      try { complete(proposal.event); } catch { return needs('dateTime'); }
      const deleted = this.all<{ event?: CalendarEvent; baseline?: Fields }>('deleted_events');
      const legacyDeleted = this.all<{ event: CalendarEvent | null }>('confirm_results').filter(result => result.event && this.get('deleted_events', result.event.id));
      if ([...deleted.flatMap(item => [item.event, item.baseline]), ...legacyDeleted.map(item => item.event)].some(old => old && sameBooking(old, proposal.event, false))) return finish(null, 'suppressed');
      const duplicate = this.events().find(event => { const metadata = this.get<AutomationMetadata>('event_automation', event.id); return [event, metadata?.baseline, ...(metadata?.identities || [])].some(old => old && sameBooking(old, proposal.event)); });
      if (duplicate) {
        const metadata = this.get<AutomationMetadata>('event_automation', duplicate.id);
        if (attendance === 'confirmed' && duplicate.attendance === 'invited' && metadata?.managed && !metadata.ownerFields.includes('attendance') && (!metadata.lastSourceAt || sourceAt && sourceAt >= metadata.lastSourceAt)) {
          const event: CalendarEvent = { ...duplicate, attendance, revision: duplicate.revision + 1 }; this.saveEvent(event); metadata.baseline.attendance = attendance; recordSource(metadata); this.put('event_automation', event.id, metadata); return finish(event, 'updated');
        }
        if (metadata && compatibleIdentity(duplicate, proposal.event)) { recordSource(metadata); this.put('event_automation', duplicate.id, metadata); }
        return finish(duplicate, 'duplicate');
      }
      const event = this.createEvent({ ...proposal.event, attendance }, 'Gmail');
      const metadata: AutomationMetadata = { baseline: eventFields(event), ownerFields: [], managed: true, identities: [eventFields(event)] }; recordSource(metadata); this.put('event_automation', event.id, metadata);
      return finish(event, 'created');
    }
    if (!proposal.targetEventId || proposal.targetRevision === undefined) return needs('targetEventId');
    let old: CalendarEvent;
    try { old = this.requireEvent(proposal.targetEventId, proposal.targetRevision); } catch { return needs('targetRevision'); }
    const metadata = this.get<AutomationMetadata>('event_automation', old.id);
    // Legacy/manual events have no reliable per-field provenance. Leave changes
    // to those plans for explicit resolution instead of guessing ownership.
    if (!metadata?.managed) return needs('ownerEditedEvent');
    const referenceMatch = old.reference && proposal.event.reference && normalized(old.reference) === normalized(proposal.event.reference);
    const referenceConflict = old.reference && proposal.event.reference && normalized(old.reference) !== normalized(proposal.event.reference);
    const identityMatch = normalized(old.title) === normalized(proposal.event.title) && (old.date === proposal.event.date || sourceThreads.some(thread => metadata.sourceThreads?.includes(thread)));
    if (referenceConflict || !referenceMatch && !identityMatch) return needs('targetIdentity');
    if (metadata.lastSourceAt && (!sourceAt || sourceAt < metadata.lastSourceAt)) return sourceAt ? finish(old, 'duplicate') : needs('sourceChronology');
    const competing = this.events().filter(event => event.id !== old.id && compatibleIdentity(event, proposal.event));
    if (competing.length || proposal.action === 'cancel' && !compatibleIdentity(old, proposal.event)) return needs('targetIdentity');
    if (referenceMatch && normalized(old.title) !== normalized(proposal.event.title) && this.events().some(event => event.id !== old.id && event.reference && normalized(event.reference) === normalized(old.reference))) return needs('targetIdentity');
    if (proposal.action === 'cancel') {
      if (metadata.ownerFields.length) return needs('ownerEditedEvent');
      this.removeEvent(old); return finish(null, 'cancelled');
    }
    const before = eventFields(old); let next = suppliedFields(before, proposal.event);
    next.attendance = before.attendance === 'confirmed' || attendance === 'confirmed' ? 'confirmed' : 'invited';
    for (const key of metadata.ownerFields) {
      const field = key as keyof Fields;
      if (key !== 'attendance' && key !== 'reminderMinutes' && !sameValue(next[field], before[field]) && !sameValue(next[field], metadata.baseline[field])) return needs(`ownerEdited:${key}`);
      if (before[field] === undefined) delete next[field]; else (next as Record<string, unknown>)[key] = before[field];
    }
    try { next = complete(next); } catch { return needs('dateTime'); }
    if (sameValue(next, before)) { recordSource(metadata); this.put('event_automation', old.id, metadata); return finish(old, 'duplicate'); }
    const event: CalendarEvent = { ...next, date: next.date!, id: old.id, source: old.source, revision: old.revision + 1 };
    this.saveEvent(event); metadata.identities = [...(metadata.identities || [metadata.baseline]), eventFields(event)]; metadata.baseline = { ...suppliedFields(metadata.baseline, proposal.event), attendance }; recordSource(metadata); this.put('event_automation', event.id, metadata);
    return finish(event, 'updated');
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
