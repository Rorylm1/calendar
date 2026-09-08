import type { Config } from './config.ts';
import { EventFields, type GmailConnection, type Proposal, type SourceMessage } from './domain.ts';
import { Store } from './store.ts';
import { ProviderError, ProcessingPaused, safeError } from './errors.ts';
import { excluded, normalizeMessage, parts, sourceCorpus, type GmailMessage } from './mail.ts';
import type { GmailProvider } from './gmail.ts';
import { Extraction, type Interpreter } from './interpreter.ts';

type Scan = { mode: 'initial' | 'history' | 'recovery'; baseline: string; query?: string; pageToken?: string; pageIds?: string[]; nextPageToken?: string; finalHistoryId?: string };
const HOUR = 3600000;
// Models sometimes spell minute-precision times with zero seconds. This is
// lossless; nonzero seconds and malformed times still fail domain validation.
const minuteTime = (value: string | null) => value && /^(?:[01]\d|2[0-3]):[0-5]\d:00$/.test(value) ? value.slice(0, 5) : value;
export class CalendarWorker {
  private active?: Promise<void>;
  private operation?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private queueTimer?: ReturnType<typeof setTimeout>;
  private started = false;
  private stopped = false;
  private captureRequested = false;
  private capturePhase = 'starting';
  syncing = false;
  processingStatus: 'idle' | 'processing' | 'paused_missing_key' | 'paused_budget' | 'error' = 'idle';
  processingError: string | null = null;
  constructor(private config: Config, private store: Store, private provider: (signal?: AbortSignal) => GmailProvider, private interpreter: Interpreter) {}
  start() { this.stopped = false; this.started = true; this.schedule(); this.continueQueue(); }
  private continueQueue() {
    if (!this.started || this.stopped || this.active || this.queueTimer) return;
    const connection = this.store.get<GmailConnection>('connection'); const scan = this.store.get<Scan>('scan');
    const continueImport = Boolean(scan && connection?.status === 'connected' && !connection.error);
    if (!continueImport && (!this.store.pending(1).length || this.processingStatus.startsWith('paused_'))) return;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = undefined; if (this.stopped || this.active) return;
      const fresh = this.store.get<GmailConnection>('connection');
      if (this.store.get('scan') && fresh?.status === 'connected' && !fresh.error) this.kick();
      else if (this.store.pending(1).length && !this.processingStatus.startsWith('paused_')) this.kickProcessing();
    }, 500); this.queueTimer.unref();
  }
  kickProcessing() {
    if (this.active || this.stopped) return;
    if (this.queueTimer) clearTimeout(this.queueTimer); this.queueTimer = undefined; this.operation = new AbortController();
    this.active = this.process(this.operation.signal).finally(() => { this.active = undefined; this.operation = undefined; this.continueQueue(); });
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer); if (this.stopped || this.active) return;
    const connection = this.store.get<GmailConnection>('connection');
    const delay = connection?.status === 'connected' ? Math.max(100, Date.parse(connection.nextSyncAt) - Date.now()) : HOUR;
    this.timer = setTimeout(() => { void this.run().finally(() => this.schedule()); }, delay); this.timer.unref();
  }
  kick(): void { void this.run().finally(() => this.schedule()); }
  async stop() { this.stopped = true; this.started = false; this.captureRequested = false; this.operation?.abort(); if (this.timer) clearTimeout(this.timer); if (this.queueTimer) clearTimeout(this.queueTimer); this.queueTimer = undefined; await this.active; }
  async run(): Promise<void> {
    if (this.stopped) return;
    if (this.active) { this.captureRequested = true; await this.active; if (this.captureRequested && !this.stopped) return this.run(); return; }
    this.captureRequested = false;
    if (this.queueTimer) clearTimeout(this.queueTimer); this.queueTimer = undefined; this.operation = new AbortController();
    this.active = this.runOnce(this.operation.signal).finally(() => { this.active = undefined; this.operation = undefined; this.continueQueue(); }); return this.active;
  }
  private async runOnce(signal: AbortSignal) {
    this.store.pruneSources();
    const connection = this.store.get<GmailConnection>('connection'); if (!connection || connection.status !== 'connected') { await this.process(signal); return; }
    this.syncing = true;
    connection.error = null; this.store.put('connection', 'default', connection);
    try { await this.capture(this.provider(signal), connection); }
    catch (error) {
      if (signal.aborted) return;
      this.store.put('capture_diagnostic', 'default', { phase: this.capturePhase, errorClass: error instanceof ProviderError ? 'ProviderError' : error instanceof TypeError ? 'TypeError' : error instanceof RangeError ? 'RangeError' : 'Error', status: error instanceof ProviderError ? error.status : null, retryable: error instanceof ProviderError && error.retryable, rateLimitReason: error instanceof ProviderError ? error.rateLimitReason : undefined, at: new Date().toISOString() });
      const fresh = this.store.get<GmailConnection>('connection') || connection;
      if (error instanceof ProviderError && error.reconnect) fresh.status = 'reconnect_required';
      fresh.error = safeError(error); fresh.nextSyncAt = new Date(Date.now() + HOUR).toISOString(); this.store.put('connection', 'default', fresh);
    } finally { this.syncing = false; }
    await this.process(signal); this.store.pruneSources();
  }
  async capture(provider: GmailProvider, connection: GmailConnection): Promise<void> {
    let scan = this.store.get<Scan>('scan');
    if (!scan) {
      if (connection.historyId) scan = { mode: 'history', baseline: connection.historyId };
      else scan = await this.beginBounded(provider, 'initial');
      this.store.put('scan', 'default', scan);
    }
    // Persist every page and its remaining ids, then fetch those ids before moving the checkpoint.
    const deadline = Date.now() + 90_000; let pages = 0;
    while (pages < 20 && Date.now() < deadline && !this.stopped) {
      if (!scan.pageIds) {
        try {
          if (scan.mode === 'history') {
            this.capturePhase = 'history';
            const page = await provider.history(scan.baseline, scan.pageToken);
            scan.pageIds = [...new Set((page.history || []).flatMap(row => [...(row.messagesAdded || []).map(x => x.message.id), ...(row.labelsAdded || []).map(x => x.message.id), ...(row.messages || []).map(x => x.id)]))];
            scan.nextPageToken = page.nextPageToken; scan.finalHistoryId = page.historyId;
          } else { this.capturePhase = 'list'; const page = await provider.list(scan.query!, scan.pageToken); scan.pageIds = (page.messages || []).map(x => x.id); scan.nextPageToken = page.nextPageToken; }
          this.store.put('scan', 'default', scan);
        } catch (error) {
          if (error instanceof ProviderError && error.status === 404 && scan.mode === 'history') {
            scan = await this.beginBounded(provider, 'recovery'); this.store.put('scan', 'default', scan);
            connection.warning = 'Gmail history expired. Recovering the last 30 days; older uncaptured messages may need manual entry.'; this.store.put('connection', 'default', connection); continue;
          }
          // An invalid saved list token can occur after a long outage. Restart the same bounded scan safely.
          if (error instanceof ProviderError && error.status === 400 && scan.mode !== 'history' && scan.pageToken) { delete scan.pageToken; this.store.put('scan', 'default', scan); throw error; }
          throw error;
        }
      }
      while (scan.pageIds.length && Date.now() < deadline && !this.stopped) {
        const id = scan.pageIds[0]!;
        if (!this.store.captured(id)) {
          try {
            this.capturePhase = 'message';
            const message = await provider.message(id);
            if (excluded(message)) { /* A draft may later be sent with the same message id. Do not retain a permanent exclusion. */ }
            else {
              await this.hydrateText(provider, message);
              this.capturePhase = 'thread';
              const thread = (await provider.thread(message.threadId).catch(error => { if (error instanceof ProviderError && error.status === 404) return [message]; throw error; })).filter(item => item.id !== message.id && !excluded(item)).sort((a, b) => Number(a.internalDate) - Number(b.internalDate)).slice(-8);
              for (const context of thread) await this.hydrateText(provider, context);
              const calendars: string[] = [];
              this.capturePhase = 'calendar_attachment';
              for (const part of parts(message.payload)) if ((part.mimeType === 'text/calendar' || part.filename?.toLowerCase().endsWith('.ics')) && part.body?.attachmentId && (part.body.size || 0) <= 65536) calendars.push(await provider.attachment(id, part.body.attachmentId));
              this.capturePhase = 'normalization'; const normalized = normalizeMessage(message, thread, calendars);
              this.capturePhase = 'persistence'; this.store.capture(normalized);
            }
          } catch (error) { if (error instanceof ProviderError && error.status === 404) this.store.skipSource(id); else throw error; }
        }
        scan.pageIds.shift(); this.store.put('scan', 'default', scan);
      }
      if (scan.pageIds.length) break;
      if (!scan.nextPageToken) {
        connection.historyId = scan.mode === 'history' ? scan.finalHistoryId || scan.baseline : scan.baseline;
        connection.lastSyncAt = new Date().toISOString(); connection.nextSyncAt = new Date(Date.now() + HOUR).toISOString(); connection.error = null;
        if (connection.warning === 'The scan is still running in saved batches. Check now to continue sooner.' || connection.warning === 'Initial import is in progress. Saved batches continue automatically at a gentle pace.') connection.warning = null;
        this.store.transaction(() => { this.store.put('connection', 'default', connection); this.store.remove('scan'); }); return;
      }
      scan.pageToken = scan.nextPageToken; delete scan.nextPageToken; delete scan.pageIds; this.store.put('scan', 'default', scan); pages++;
    }
    connection.nextSyncAt = new Date(Date.now() + HOUR).toISOString(); connection.error = null; connection.warning = connection.warning || 'Initial import is in progress. Saved batches continue automatically at a gentle pace.'; this.store.put('connection', 'default', connection);
  }
  private async beginBounded(provider: GmailProvider, mode: 'initial' | 'recovery'): Promise<Scan> {
    this.capturePhase = 'profile';
    const profile = await provider.profile();
    if (profile.emailAddress.toLowerCase() !== this.config.GMAIL_ALLOWED_EMAIL.toLowerCase()) throw new ProviderError(401, true);
    const now = Math.floor(Date.now() / 1000);
    return { mode, baseline: profile.historyId, query: `after:${now - 30 * 86400} before:${now + 1} -in:spam -in:trash -in:drafts` };
  }
  private async hydrateText(provider: GmailProvider, message: GmailMessage) {
    for (const part of parts(message.payload)) {
      if (!part.filename && ['text/plain', 'text/html'].includes(part.mimeType || '') && part.body?.attachmentId && !part.body.data) {
        if ((part.body.size || 0) > 1_000_000) { part.filename = 'Email body too large to read automatically'; continue; }
        this.capturePhase = 'text_attachment';
        const text = await provider.attachment(message.id, part.body.attachmentId);
        part.body.data = Buffer.from(text.slice(0, part.mimeType === 'text/html' ? 250000 : 64000)).toString('base64url');
      }
    }
  }
  async process(signal?: AbortSignal): Promise<void> {
    this.processingStatus = 'processing'; this.processingError = null;
    const sources = this.store.pending(100);
    for (const source of sources) {
      if (this.stopped) break;
      this.store.sourceStatus(source.id, 'processing');
      try {
        const triage = await this.interpreter.triage(source, signal); signal?.throwIfAborted();
        this.store.sourceStatus(source.id, 'processing', { ...triage, excerpt: source.text.slice(0, 240), subject: source.subject });
        if (triage.decision === 'irrelevant') { this.store.sourceStatus(source.id, 'filtered'); continue; }
        if (source.unsupportedAttachments.length && !source.calendar && source.text.length < 160) {
          this.store.transaction(() => {
            this.store.putProposal({ action: 'create', event: { title: source.subject || 'Review attached booking', kind: 'other', location: '', detail: `The attached file needs manual review: ${source.unsupportedAttachments.join(', ')}. Booking details have not been read.` }, attendance: 'unknown', reason: 'This message relies on an attachment that is not supported yet. Enter its booking details after reviewing the file.', evidence: [source.subject || source.unsupportedAttachments[0]!], unresolvedFields: ['date', 'attachment'], sourceMessageIds: [source.id] });
            this.store.sourceStatus(source.id, 'processed', { decision: 'manual_review', reason: 'Unsupported attachment' });
          }); continue;
        }
        const events = this.store.events(); const output = Extraction.parse(await this.interpreter.extract(source, events, this.store.proposals(), signal)); signal?.throwIfAborted();
        const proposals: Omit<Proposal, 'id' | 'createdAt' | 'revision' | 'status'>[] = [];
        for (const candidate of output.proposals) {
          if (candidate.attendance === 'declined' && candidate.action === 'create') continue;
          const rawFields = Object.fromEntries(Object.entries({ ...candidate.event, time: minuteTime(candidate.event.time), endTime: minuteTime(candidate.event.endTime) }).filter(([, value]) => value !== null)); const event = EventFields.parse(rawFields);
          const target = candidate.targetEventId ? events.find(x => x.id === candidate.targetEventId) : undefined;
          const corpus = sourceCorpus(source).replace(/\s+/g, ' ').toLowerCase();
          const evidence = candidate.evidence.filter(text => text.length > 2 && text.length <= 700 && corpus.includes(text.replace(/\s+/g, ' ').toLowerCase())).slice(0, 5);
          if (!evidence.length) throw new Error('Model returned no verifiable source excerpt');
          if (candidate.action === 'create' && events.some(existing => existing.title.toLowerCase() === event.title.toLowerCase() && existing.date === event.date && existing.time === event.time && existing.reference === event.reference)) continue;
          const unresolvedFields = [...new Set([...candidate.unresolvedFields, ...(!event.date ? ['date'] : []), ...(candidate.action !== 'create' && !target ? ['targetEventId'] : [])])];
          proposals.push({ action: candidate.action, ...(target ? { targetEventId: target.id, targetRevision: target.revision } : {}), event, attendance: candidate.attendance, reason: candidate.reason.slice(0, 1200), evidence, unresolvedFields, sourceMessageIds: [source.id] });
        }
        this.store.transaction(() => { for (const proposal of proposals) this.store.putProposal(proposal); this.store.sourceStatus(source.id, 'processed'); });
      } catch (error) {
        if (signal?.aborted) { this.store.sourceStatus(source.id, 'fetched'); this.processingStatus = 'idle'; this.processingError = null; return; }
        if (error instanceof ProcessingPaused) { this.store.sourceStatus(source.id, 'fetched'); this.processingStatus = error.reason; this.processingError = safeError(error); return; }
        this.store.sourceStatus(source.id, 'failed'); this.processingStatus = 'error'; this.processingError = 'Some captured emails could not be interpreted. They are saved and will retry on the next check.';
      }
    }
    if (this.processingStatus === 'processing') this.processingStatus = 'idle';
  }
}
