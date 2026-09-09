import type { Config } from './config.ts';
import { EventFields, type GmailConnection, type Proposal, type SourceMessage } from './domain.ts';
import { Store } from './store.ts';
import { ProviderError, ProcessingPaused, safeError } from './errors.ts';
import { excluded, normalizeMessage, parts, sourceCorpus, type GmailMessage } from './mail.ts';
import type { GmailProvider } from './gmail.ts';
import { gmailSourceId } from './gmail-accounts.ts';
import { downloadWhatsAppImage, WhatsAppMediaError } from './whatsapp-media.ts';
import { Extraction, ImageReading, type Interpreter } from './interpreter.ts';

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
  syncingAccountId: string | null = null;
  processingStatus: 'idle' | 'processing' | 'paused_missing_key' | 'paused_budget' | 'error' = 'idle';
  processingError: string | null = null;
  constructor(private config: Config, private store: Store, private provider: (signal?: AbortSignal, accountId?: string) => GmailProvider, private interpreter: Interpreter, private imageDownload: typeof downloadWhatsAppImage = downloadWhatsAppImage) {}
  start() { this.stopped = false; this.started = true; this.schedule(); this.continueQueue(); }
  private continueQueue() {
    if (!this.started || this.stopped || this.active || this.queueTimer) return;
    const continueImport = this.store.gmailConnections().some(c => this.store.get('scan', c.id) && c.status === 'connected' && !c.error);
    if (!continueImport && (!this.store.pending(1, Date.now(), this.config.WHATSAPP_PROCESSING_ENABLED).length || this.processingStatus.startsWith('paused_'))) return;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = undefined; if (this.stopped || this.active) return;
      if (this.store.gmailConnections().some(c => this.store.get('scan', c.id) && c.status === 'connected' && !c.error)) void this.run(false).finally(() => this.schedule());
      else if (this.store.pending(1, Date.now(), this.config.WHATSAPP_PROCESSING_ENABLED).length && !this.processingStatus.startsWith('paused_')) this.kickProcessing();
    }, 500); this.queueTimer.unref();
  }
  kickProcessing() {
    if (this.active || this.stopped) return;
    if (this.queueTimer) clearTimeout(this.queueTimer); this.queueTimer = undefined; this.operation = new AbortController();
    this.active = this.process(this.operation.signal).finally(() => { this.active = undefined; this.operation = undefined; this.continueQueue(); });
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer); if (this.stopped || this.active) return;
    const times = this.store.gmailConnections().filter(c => c.status === 'connected').map(c => Date.parse(c.nextSyncAt));
    const delay = times.length ? Math.max(100, Math.min(...times) - Date.now()) : HOUR;
    this.timer = setTimeout(() => { void this.run(false).finally(() => this.schedule()); }, delay); this.timer.unref();
  }
  kick(force = true): void { void this.run(force).finally(() => this.schedule()); }
  async stop() { this.stopped = true; this.started = false; this.captureRequested = false; this.operation?.abort(); if (this.timer) clearTimeout(this.timer); if (this.queueTimer) clearTimeout(this.queueTimer); this.queueTimer = undefined; await this.active; }
  async run(force = true): Promise<void> {
    if (this.stopped) return;
    if (this.active) { this.captureRequested = true; await this.active; if (this.captureRequested && !this.stopped) return this.run(force); return; }
    this.captureRequested = false;
    if (this.queueTimer) clearTimeout(this.queueTimer); this.queueTimer = undefined; this.operation = new AbortController();
    this.active = this.runOnce(this.operation.signal, force).finally(() => { this.active = undefined; this.operation = undefined; this.continueQueue(); }); return this.active;
  }
  private async runOnce(signal: AbortSignal, force: boolean) {
    this.store.pruneSources();
    const connections = this.store.gmailConnections().filter(c => c.status === 'connected' && (force || Date.parse(c.nextSyncAt) <= Date.now() || this.store.get('scan', c.id) && !c.error));
    for (const connection of connections) {
      if (signal.aborted) return;
      const accountId = connection.id;
      this.syncing = true; this.syncingAccountId = accountId;
      connection.error = null; this.store.put('connection', accountId, connection);
      try { await this.capture(this.provider(signal, accountId), connection, accountId); }
      catch (error) {
        if (signal.aborted) return;
        this.store.put('capture_diagnostic', accountId, { phase: this.capturePhase, errorClass: error instanceof ProviderError ? 'ProviderError' : 'Error', status: error instanceof ProviderError ? error.status : null, retryable: error instanceof ProviderError && error.retryable, rateLimitReason: error instanceof ProviderError ? error.rateLimitReason : undefined, at: new Date().toISOString() });
        const fresh = this.store.get<GmailConnection>('connection', accountId) || connection;
        if (error instanceof ProviderError && error.reconnect) fresh.status = 'reconnect_required';
        fresh.error = safeError(error); fresh.nextSyncAt = new Date(Date.now() + HOUR).toISOString(); this.store.put('connection', accountId, fresh);
      } finally { this.syncing = false; this.syncingAccountId = null; }
    }
    await this.process(signal); this.store.pruneSources();
  }
  async capture(provider: GmailProvider, connection: GmailConnection, accountId = 'default'): Promise<void> {
    let scan = this.store.get<Scan>('scan', accountId);
    if (!scan) {
      if (connection.historyId) scan = { mode: 'history', baseline: connection.historyId };
      else scan = await this.beginBounded(provider, 'initial', connection.email);
      this.store.put('scan', accountId, scan);
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
          this.store.put('scan', accountId, scan);
        } catch (error) {
          if (error instanceof ProviderError && error.status === 404 && scan.mode === 'history') {
            scan = await this.beginBounded(provider, 'recovery', connection.email); this.store.put('scan', accountId, scan);
            connection.warning = 'Gmail history expired. Recovering the last 30 days; older uncaptured messages may need manual entry.'; this.store.put('connection', accountId, connection); continue;
          }
          // An invalid saved list token can occur after a long outage. Restart the same bounded scan safely.
          if (error instanceof ProviderError && error.status === 400 && scan.mode !== 'history' && scan.pageToken) { delete scan.pageToken; this.store.put('scan', accountId, scan); throw error; }
          throw error;
        }
      }
      while (scan.pageIds.length && Date.now() < deadline && !this.stopped) {
        const id = scan.pageIds[0]!; const sourceId = gmailSourceId(accountId, id);
        if (!this.store.captured(sourceId)) {
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
              normalized.id = sourceId; normalized.threadId = gmailSourceId(accountId, normalized.threadId); normalized.context = normalized.context.map(item => ({ ...item, id: gmailSourceId(accountId, item.id) })); normalized.gmailAccountId = accountId; normalized.gmailEmail = connection.email;
              this.capturePhase = 'persistence'; this.store.capture(normalized);
            }
          } catch (error) { if (error instanceof ProviderError && error.status === 404) this.store.skipSource(sourceId); else throw error; }
        }
        scan.pageIds.shift(); this.store.put('scan', accountId, scan);
      }
      if (scan.pageIds.length) break;
      if (!scan.nextPageToken) {
        connection.historyId = scan.mode === 'history' ? scan.finalHistoryId || scan.baseline : scan.baseline;
        connection.lastSyncAt = new Date().toISOString(); connection.nextSyncAt = new Date(Date.now() + HOUR).toISOString(); connection.error = null;
        if (connection.warning === 'The scan is still running in saved batches. Check now to continue sooner.' || connection.warning === 'Initial import is in progress. Saved batches continue automatically at a gentle pace.') connection.warning = null;
        this.store.transaction(() => { this.store.put('connection', accountId, connection); this.store.remove('scan', accountId); }); return;
      }
      scan.pageToken = scan.nextPageToken; delete scan.nextPageToken; delete scan.pageIds; this.store.put('scan', accountId, scan); pages++;
    }
    connection.nextSyncAt = new Date(Date.now() + HOUR).toISOString(); connection.error = null; connection.warning = connection.warning || 'Initial import is in progress. Saved batches continue automatically at a gentle pace.'; this.store.put('connection', accountId, connection);
  }
  private async beginBounded(provider: GmailProvider, mode: 'initial' | 'recovery', email: string): Promise<Scan> {
    this.capturePhase = 'profile';
    const profile = await provider.profile();
    if (profile.emailAddress.toLowerCase() !== email.toLowerCase()) throw new ProviderError(401, true);
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
    const sources = this.store.pending(40, Date.now(), this.config.WHATSAPP_PROCESSING_ENABLED);
    for (const source of sources) {
      if (this.stopped) break;
      this.store.sourceStatus(source.id, 'processing');
      try {
        if (source.whatsapp?.mediaId && !source.whatsapp.imageRead) {
          const image = await this.imageDownload(this.config, source, signal);
          if (!this.interpreter.readImage) throw new Error('Image interpretation unavailable');
          const reading = ImageReading.parse(await this.interpreter.readImage(image, signal)); signal?.throwIfAborted();
          source.text = [source.text, reading.text].filter(Boolean).join('\n');
          source.whatsapp = { ...source.whatsapp, imageRead: true, imageUnclear: reading.unclear, imageReason: reading.reason };
          this.store.replaceSource(source); this.store.remove('whatsapp_media_error');
        }
        // A partial description does not invalidate a readable title and date.
        // Let extraction assess individual missing facts from any readable text.
        const manualWhatsApp = source.channel === 'whatsapp' && (source.unsupportedAttachments.length > 0 || source.whatsapp?.imageRead && !source.text.trim());
        if (manualWhatsApp) {
          this.store.transaction(() => {
            this.store.putProposal({ source: 'WhatsApp', action: 'create', event: { title: source.subject, kind: 'other', location: '', detail: source.whatsapp?.imageReason || 'This attachment could not be read. Enter the booking details.' }, attendance: 'unknown', reason: 'The forwarded image or attachment needs clearer details before an event can be added.', evidence: [source.subject], unresolvedFields: ['date', 'attachment'], sourceMessageIds: [source.id] });
            this.store.sourceStatus(source.id, 'processed', { decision: 'manual_review', reason: 'Attachment needs details', subject: source.subject });
          }); continue;
        }
        const triage = source.channel === 'whatsapp' ? { decision: 'relevant', reason: 'Selected WhatsApp capture' } : await this.interpreter.triage(source, signal); signal?.throwIfAborted();
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
          const rawFields = Object.fromEntries(Object.entries({ ...candidate.event, time: minuteTime(candidate.event.time), endTime: minuteTime(candidate.event.endTime) }).filter(([, value]) => value !== null)); const event = EventFields.parse(rawFields);
          const target = candidate.targetEventId ? events.find(x => x.id === candidate.targetEventId) : undefined;
          const corpus = sourceCorpus(source).replace(/\s+/g, ' ').toLowerCase();
          const evidence = candidate.evidence.filter(text => text.length > 2 && text.length <= 700 && corpus.includes(text.replace(/\s+/g, ' ').toLowerCase())).slice(0, 5);
          if (!evidence.length) throw new Error('Model returned no verifiable source excerpt');
          const relativeForward = source.channel === 'whatsapp' && (source.whatsapp?.forwarded || source.whatsapp?.mediaId) && /\b(tomorrow|today|tonight|yesterday|(?:next|this|last)\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(source.text);
          if (relativeForward) { delete event.date; delete event.endDate; }
          const unresolvedFields = [...new Set([...candidate.unresolvedFields, ...(relativeForward ? ['originalDate', 'date'] : []), ...(source.whatsapp?.forwarded && candidate.action !== 'create' ? ['sourceChronology'] : []), ...(!event.date ? ['date'] : []), ...(candidate.action !== 'create' && !target ? ['targetEventId'] : [])])];
          proposals.push({ ...(source.channel === 'whatsapp' ? { source: 'WhatsApp' as const } : {}), action: candidate.action, ...(target ? { targetEventId: target.id, targetRevision: target.revision } : {}), event, attendance: candidate.attendance, reason: candidate.reason.slice(0, 1200), evidence, unresolvedFields, sourceMessageIds: [source.id] });
        }
        this.store.transaction(() => {
          const proposalIds = proposals.map(proposal => this.store.putProposal(proposal)?.id).filter((id): id is string => Boolean(id));
          this.store.autoApplyPending({ proposalIds }); this.store.resolveWhatsAppReply(source, proposalIds); this.store.sourceStatus(source.id, 'processed');
        });
      } catch (error) {
        if (signal?.aborted) { this.store.sourceStatus(source.id, 'fetched'); this.processingStatus = 'idle'; this.processingError = null; return; }
        if (error instanceof ProcessingPaused) { this.store.sourceStatus(source.id, 'fetched'); this.processingStatus = error.reason; this.processingError = safeError(error); return; }
        if (error instanceof WhatsAppMediaError && error.reason === 'unsupported') {
          this.store.transaction(() => { this.store.putProposal({ source: 'WhatsApp', action: 'create', event: { title: source.subject, kind: 'other', location: '', detail: 'Send a clear JPEG or PNG screenshot under 5 MB, or enter the booking details.' }, attendance: 'unknown', reason: 'This image could not be safely read.', evidence: [source.subject], unresolvedFields: ['date', 'attachment'], sourceMessageIds: [source.id] }); this.store.sourceStatus(source.id, 'processed'); });
          continue;
        }
        if (error instanceof WhatsAppMediaError) this.store.put('whatsapp_media_error', 'default', { reason: error.reason, at: new Date().toISOString() });
        this.store.sourceStatus(source.id, 'failed'); this.processingStatus = 'error'; this.processingError = error instanceof WhatsAppMediaError && error.reason === 'access' ? 'WhatsApp screenshots need a renewed media-access connection. Text capture still works.' : 'Some captured messages could not be interpreted. They are saved and will retry on the next check.';
      }
    }
    if (this.processingStatus === 'processing') this.processingStatus = 'idle';
  }
}
