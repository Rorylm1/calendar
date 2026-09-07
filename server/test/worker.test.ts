import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarWorker } from '../src/worker.ts';
import { ProviderError } from '../src/errors.ts';
import { retryGmailRead } from '../src/gmail.ts';
import { ModelInterpreter } from '../src/interpreter.ts';
import type { GmailConnection } from '../src/domain.ts';
import { connection, fields, fixture, interpreter, mail, output, provider, source } from './helpers.ts';

test('initial pagination resumes fetched work after failure and checkpoints only durable captures', async () => {
  const { config, store } = fixture(); const connected = connection(); store.put('connection', 'default', connected);
  let fail = true; let firstFetches = 0; const queries: string[] = [];
  const gmail = provider({ list: async (query, page) => { queries.push(query); return page ? { messages: [{ id: 'm2' }] } : { messages: [{ id: 'm1' }], nextPageToken: 'second' }; }, message: async id => { if (id === 'm1') firstFetches++; if (id === 'm2' && fail) throw new ProviderError(503); return mail(id); } });
  const worker = new CalendarWorker(config, store, () => gmail, interpreter());
  await assert.rejects(worker.capture(gmail, connected)); assert.equal(store.captured('m1'), true); assert.equal(store.get<GmailConnection>('connection')!.historyId, undefined);
  fail = false; const restarted = new CalendarWorker(config, store, () => gmail, interpreter()); await restarted.capture(gmail, connected);
  assert.equal(firstFetches, 1); assert.equal(store.get<GmailConnection>('connection')!.historyId, '100'); assert.equal(store.counts().pendingMessages, 2);
  assert.ok(queries.every(q => q.includes('-in:spam') && !q.includes('category:') && !q.includes('flight'))); assert.equal(store.events().length, 0); store.close();
});
test('model failure cannot lose mail when the Gmail history checkpoint advances', async () => {
  const { config, store } = fixture(); store.put('connection', 'default', connection('100'));
  const gmail = provider({ history: async () => ({ historyId: '201', history: [{ messagesAdded: [{ message: { id: 'm1' } }] }] }) });
  const worker = new CalendarWorker(config, store, () => gmail, { ...interpreter(), extract: async () => { throw new Error('synthetic model failure'); } });
  await worker.run(); assert.equal(store.get<GmailConnection>('connection')!.historyId, '201'); assert.equal(store.counts().failedMessages, 1); assert.equal(store.events().length, 0);
  assert.equal(store.captured('m1'), true); assert.equal(store.pending().length, 0); store.retryFailures(); assert.equal(store.pending()[0]!.id, 'm1'); store.close();
});
test('expired history triggers bounded recovery and a visible gap warning', async () => {
  const { config, store } = fixture(); const connected = connection('expired'); store.put('connection', 'default', connected);
  const gmail = provider({ history: async () => { throw new ProviderError(404); }, profile: async () => ({ emailAddress: config.GMAIL_ALLOWED_EMAIL, historyId: '300' }) });
  const worker = new CalendarWorker(config, store, () => gmail, interpreter()); await worker.capture(gmail, connected);
  const result = store.get<GmailConnection>('connection')!; assert.equal(result.historyId, '300'); assert.match(result.warning!, /older uncaptured/); assert.equal(store.counts().pendingMessages, 1); store.close();
});
test('Promotions and unfamiliar senders are captured with sent reply context', async () => {
  const { config, store } = fixture(); const connected = connection(); store.put('connection', 'default', connected);
  const gmail = provider({ message: async () => mail('m1', undefined, ['CATEGORY_PROMOTIONS']), thread: async () => [mail('sent-reply', 'Yes, see you there.', ['SENT'])] });
  const worker = new CalendarWorker(config, store, () => gmail, interpreter()); await worker.capture(gmail, connected);
  assert.equal(store.pending().length, 1); assert.equal(store.pending()[0]!.context[0]!.sentByOwner, true); await worker.process(); assert.equal(store.proposals().length, 1); assert.equal(store.events().length, 0); store.close();
});
test('multiple itinerary legs and a hotel remain separate reviewed items', async () => {
  const { config, store } = fixture(); store.capture(source());
  const results = [
    fields({ title: 'Flight outbound', kind: 'travel', date: '2026-09-22', reference: 'SAME-TRIP' }),
    fields({ title: 'Flight home', kind: 'travel', date: '2026-09-24', reference: 'SAME-TRIP' }),
    fields({ title: 'Hotel stay', kind: 'stay', date: '2026-09-22', endDate: '2026-09-24', time: undefined, reference: 'SAME-TRIP' }),
  ].flatMap(event => output(event).proposals);
  const worker = new CalendarWorker(config, store, () => provider(), interpreter({ proposals: results })); await worker.process();
  assert.equal(store.proposals().length, 3); assert.equal(store.events().length, 0);
  for (const item of store.proposals()) store.confirm(item.id); assert.equal(store.events().length, 3); assert.equal(store.events().find(x => x.kind === 'stay')!.time, undefined); store.close();
});
test('marketing triage is auditable and creates no calendar proposal', async () => {
  const { config, store } = fixture(); store.capture(source('ad', 'Flights from £29 this weekend. Browse our sale.'));
  const worker = new CalendarWorker(config, store, () => provider(), { triage: async () => ({ decision: 'irrelevant', reason: 'A general sale, no booking.' }), extract: async () => { throw new Error('Extraction must not run'); } }); await worker.process();
  assert.equal(store.counts().filteredMessages, 1); assert.equal(store.proposals().length, 0); assert.equal(store.audit()[0]!.decision, 'irrelevant'); store.close();
});
test('attachment-only mail is explicitly reviewable and cannot confirm without a date', async () => {
  const { config, store } = fixture(); store.capture({ ...source('pdf', 'See your ticket attached.'), unsupportedAttachments: ['ticket.pdf'] });
  const worker = new CalendarWorker(config, store, () => provider(), interpreter()); await worker.process();
  const item = store.proposals()[0]!; assert.equal(item.event.date, undefined); assert.ok(item.unresolvedFields.includes('attachment')); assert.throws(() => store.confirm(item.id)); assert.equal(store.events().length, 0); store.close();
});
test('missing model key pauses interpretation while retaining captures', async () => {
  const { config, store } = fixture(); store.capture(source()); const worker = new CalendarWorker(config, store, () => provider(), new ModelInterpreter(config, store)); await worker.process();
  assert.equal(worker.processingStatus, 'paused_missing_key'); assert.equal(store.counts().pendingMessages, 1); assert.equal(store.proposals().length, 0); store.close();
});
test('configured zero budget pauses before making any model request', async () => {
  const { config, store } = fixture(); config.OPENROUTER_API_KEY = 'synthetic-never-sent'; config.AI_MONTHLY_BUDGET_USD = 0; store.capture(source());
  const worker = new CalendarWorker(config, store, () => provider(), new ModelInterpreter(config, store)); await worker.process();
  assert.equal(worker.processingStatus, 'paused_budget'); assert.equal(store.counts().pendingMessages, 1); assert.equal(store.spend(), 0); store.close();
});
test('unverifiable model evidence is rejected, preserving captured work', async () => {
  const { config, store } = fixture(); store.capture(source()); const worker = new CalendarWorker(config, store, () => provider(), interpreter(output(fields(), { evidence: ['A sentence absent from the source'] })));
  await worker.process(); assert.equal(store.proposals().length, 0); assert.equal(store.counts().failedMessages, 1); store.close();
});
test('a decline creates no event, while an unaccepted invitation remains a proposal', async () => {
  const { config, store } = fixture(); store.capture(source()); const worker = new CalendarWorker(config, store, () => provider(), interpreter(output(fields(), { attendance: 'invited' })));
  await worker.process(); assert.equal(store.proposals()[0]!.attendance, 'invited'); assert.equal(store.events().length, 0);
  store.capture(source('decline')); const declining = new CalendarWorker(config, store, () => provider(), interpreter(output(fields(), { attendance: 'declined' }))); await declining.process(); assert.equal(store.proposals().length, 1); store.close();
});
test('detached text bodies are fetched and interpreted instead of disappearing', async () => {
  const { config, store } = fixture(); const connected = connection(); const message = mail(); message.payload!.body = { attachmentId: 'detached-body', size: 120 };
  const gmail = provider({ message: async () => message, attachment: async () => 'Your table at Luca is confirmed for 8 September 2026 at 19:30.' });
  const worker = new CalendarWorker(config, store, () => gmail, interpreter()); await worker.capture(gmail, connected); assert.match(store.pending()[0]!.text, /table at Luca/); await worker.process(); assert.equal(store.proposals().length, 1); store.close();
});
test('advertising with an image attachment still goes through triage and stays filtered', async () => {
  const { config, store } = fixture(); store.capture({ ...source('sale', 'Sale! 50% off all rooms this week.'), unsupportedAttachments: ['hero-image.png'] }); let calls = 0;
  const worker = new CalendarWorker(config, store, () => provider(), { triage: async () => { calls++; return { decision: 'irrelevant', reason: 'General advertising' }; }, extract: async () => { throw new Error('Should not extract'); } });
  await worker.process(); assert.equal(calls, 1); assert.equal(store.proposals().length, 0); assert.equal(store.counts().filteredMessages, 1); store.close();
});
test('retention runs even when Gmail requires reconnecting', async () => {
  const { config, store } = fixture(); store.put('connection', 'default', { ...connection(), status: 'reconnect_required' }); store.capture(source('old')); store.sourceStatus('old', 'filtered', { excerpt: 'Private source text', decision: 'irrelevant' }); store.put('triage', 'old', { decision: 'irrelevant' }); store.db.prepare('UPDATE sources SET captured_at=? WHERE id=?').run('2020-01-01T00:00:00Z', 'old');
  const worker = new CalendarWorker(config, store, () => { throw new Error('Must not access disconnected Gmail'); }, interpreter()); await worker.run();
  const row = store.db.prepare('SELECT payload,audit FROM sources WHERE id=?').get('old') as { payload: string | null; audit: string | null }; assert.equal(row.payload, null); assert.equal(row.audit, null); assert.equal(store.get('triage', 'old'), undefined); store.close();
});
test('Check now during interpretation queues one capture after the active work', async () => {
  const { config, store } = fixture(); store.put('connection', 'default', connection('100')); store.capture(source());
  let release!: () => void; let entered!: () => void; const processing = new Promise<void>(resolve => { entered = resolve; }); const blocked = new Promise<void>(resolve => { release = resolve; }); let captureCalls = 0;
  const gmail = provider({ history: async () => { captureCalls++; return { historyId: '200', history: [] }; } });
  const worker = new CalendarWorker(config, store, () => gmail, { ...interpreter(), triage: async () => { entered(); await blocked; return { decision: 'irrelevant', reason: 'Synthetic irrelevant message' }; } });
  worker.kickProcessing(); await processing; const firstCheck = worker.run(); const secondCheck = worker.run(); assert.equal(captureCalls, 0); release(); await Promise.all([firstCheck, secondCheck]);
  assert.equal(captureCalls, 1); assert.equal(store.get<GmailConnection>('connection')!.historyId, '200'); store.close();
});
test('capture errors keep only safe phase/status diagnostics', async () => {
  const { config, store } = fixture(); store.put('connection', 'default', connection());
  const gmail = provider({ message: async () => { throw new ProviderError(503); } }); const worker = new CalendarWorker(config, store, () => gmail, interpreter()); await worker.run();
  const diagnostic = store.get<{ phase: string; status: number; retryable: boolean }>('capture_diagnostic')!; assert.equal(diagnostic.phase, 'message'); assert.equal(diagnostic.status, 503); assert.equal(diagnostic.retryable, true); assert.ok(!JSON.stringify(diagnostic).includes('m1')); store.close();
});
test('a successful bounded import continues automatically using its saved query, even while AI is paused', async () => {
  const { config, store } = fixture(); config.OPENROUTER_API_KEY = 'synthetic-never-sent'; config.AI_MONTHLY_BUDGET_USD = 0;
  store.put('connection', 'default', connection()); store.capture(source());
  let profileCalls = 0; let listCalls = 0; const queries: string[] = [];
  const gmail = provider({ profile: async () => { profileCalls++; return { emailAddress: config.GMAIL_ALLOWED_EMAIL, historyId: '100' }; }, list: async (query, token) => { queries.push(query); listCalls++; const page = Number(token || 0); return { messages: [], ...(page < 20 ? { nextPageToken: String(page + 1) } : {}) }; } });
  const worker = new CalendarWorker(config, store, () => gmail, new ModelInterpreter(config, store));
  try {
    await worker.run(); assert.equal(listCalls, 20); assert.equal(worker.processingStatus, 'paused_budget'); assert.ok(store.get('scan')); assert.match(store.get<GmailConnection>('connection')!.warning!, /continue automatically/);
    worker.start(); const deadline = Date.now() + 3000;
    while (store.get('scan') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(store.get('scan'), undefined); assert.equal(listCalls, 21); assert.equal(profileCalls, 1); assert.equal(new Set(queries).size, 1);
    const result = store.get<GmailConnection>('connection')!; assert.ok(result.lastSyncAt); assert.equal(result.warning, null); assert.equal(result.error, null); assert.ok(Date.parse(result.nextSyncAt) > Date.now() + 3500000); assert.equal(store.counts().pendingMessages, 1); assert.equal(store.spend(), 0);
  } finally { await worker.stop(); store.close(); }
});
test('a failed saved import waits for the next check instead of repeatedly continuing', async () => {
  const { config, store } = fixture(); store.put('connection', 'default', connection()); let calls = 0;
  const gmail = provider({ list: async () => { calls++; throw new ProviderError(403, false, true, 0, 'rateLimitExceeded'); } });
  const worker = new CalendarWorker(config, store, () => gmail, interpreter());
  try {
    await worker.run(); assert.equal(calls, 1); assert.ok(store.get('scan')); assert.match(store.get<GmailConnection>('connection')!.error!, /Gmail is limiting/);
    assert.equal(store.get<{ rateLimitReason: string }>('capture_diagnostic')!.rateLimitReason, 'rateLimitExceeded');
    worker.start(); await new Promise(resolve => setTimeout(resolve, 650)); assert.equal(calls, 1);
  } finally { await worker.stop(); store.close(); }
});
test('a manual completion cancels a queued continuation instead of starting a new history check', async () => {
  const { config, store } = fixture(); store.put('connection', 'default', { ...connection(), nextSyncAt: new Date(Date.now() + 3600000).toISOString() }); store.put('scan', 'default', { mode: 'initial', baseline: '100', query: 'saved-bounded-query' });
  let lists = 0; let histories = 0; const gmail = provider({ list: async () => { lists++; return { messages: [] }; }, history: async () => { histories++; return { historyId: '200', history: [] }; } });
  const worker = new CalendarWorker(config, store, () => gmail, interpreter());
  try { worker.start(); await worker.run(); await new Promise(resolve => setTimeout(resolve, 650)); assert.equal(lists, 1); assert.equal(histories, 0); assert.equal(store.get('scan'), undefined); }
  finally { await worker.stop(); store.close(); }
});
test('stopping cancels Gmail quota cooldown and retains its unfinished scan', async () => {
  const { config, store } = fixture(); store.put('connection', 'default', connection()); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
  const worker = new CalendarWorker(config, store, signal => provider({ list: async () => retryGmailRead(async () => { calls++; entered(); throw new ProviderError(403, false, true, 0, 'rateLimitExceeded'); }, undefined, signal) }), interpreter());
  const running = worker.run(); await started; await new Promise(resolve => setTimeout(resolve, 10)); await worker.stop(); await running;
  assert.equal(calls, 1); assert.equal(store.get<GmailConnection>('connection')!.error, null); assert.ok(store.get('scan')); assert.equal(store.get('capture_diagnostic'), undefined); store.close();
});
test('stopping interpretation aborts its request and leaves the message pending', async () => {
  const { config, store } = fixture(); store.capture(source()); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const worker = new CalendarWorker(config, store, () => provider(), { ...interpreter(), triage: async (_source, signal) => { entered(); return new Promise((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })); } });
  worker.kickProcessing(); await started; await worker.stop(); assert.equal(store.counts().pendingMessages, 1); assert.equal(store.counts().failedMessages, 0); assert.equal(store.proposals().length, 0); assert.equal(worker.processingStatus, 'idle'); store.close();
});
