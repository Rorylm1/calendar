import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { CalendarWorker } from '../src/worker.ts';
import { renderCalendarFeed } from '../src/calendar-feed.ts';
import { captureWhatsAppMessages, enqueueWhatsAppBacklog, parseWhatsAppMessages } from '../src/whatsapp.ts';
import { downloadWhatsAppImage, WhatsAppMediaError, MAX_IMAGE_BYTES } from '../src/whatsapp-media.ts';
import { config, source, fields, output, interpreter } from './helpers.ts';
import type { Interpreter } from '../src/interpreter.ts';
const cfg = () => ({ ...config(), WHATSAPP_PROCESSING_ENABLED: true, WHATSAPP_APP_SECRET: 'a'.repeat(32), WHATSAPP_VERIFY_TOKEN: 'b'.repeat(32), WHATSAPP_OWNER_SENDER_ID: '447700900123', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_ACCESS_TOKEN: 'synthetic-only' });
const text = 'Invitation: dinner at Luca on 12 September 2026 at 19:30 in London.';
const event = fields({ date: '2026-09-12' });
const result = () => output(event, { attendance: 'invited', evidence: [text] });
function payload(id = 'forward1', patch: Record<string, unknown> = {}) {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '123456' }, messages: [{ id, from: '447700900123', timestamp: '1788904800', type: 'text', text: { body: text }, context: { forwarded: true }, ...patch }] } }] }] };
}
function setup(model: Interpreter = interpreter(result()), download = downloadWhatsAppImage) {
  const c = cfg(); const store = new Store(':memory:', c.CALENDAR_ENCRYPTION_KEY); const worker = new CalendarWorker(c, store, () => { throw new Error('No Gmail access expected'); }, model, download);
  return { c, store, worker, capture(id?: string, patch?: Record<string, unknown>) { captureWhatsAppMessages(store, parseWhatsAppMessages(payload(id, patch), c), true); } };
}
test('signed WhatsApp capture enters durable queue before acknowledgement and automatically creates an invitation once', async () => {
  const f = setup(); const { app } = buildApp(f.c, { store: f.store, worker: f.worker, schedule: false });
  try {
    const raw = JSON.stringify(payload()); const headers = { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', f.c.WHATSAPP_APP_SECRET).update(raw).digest('hex')}` };
    assert.equal((await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: raw, headers })).statusCode, 200);
    assert.equal(f.store.pending().length, 1); assert.equal(f.store.events().length, 0);
    await f.worker.process(); assert.equal(f.store.events().length, 1); assert.equal(f.store.events()[0]!.attendance, 'invited'); assert.equal(f.store.events()[0]!.source, 'WhatsApp');
    const feed = renderCalendarFeed(f.store).body;
    assert.match(feed, /SUMMARY:INVITATION: /); assert.match(feed, /STATUS:TENTATIVE/); assert.doesNotMatch(feed, /BEGIN:VALARM/);
    await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: raw, headers }); f.capture('second-forward'); await f.worker.process(); assert.equal(f.store.events().length, 1);
  } finally { await app.close(); f.store.close(); }
});
test('forwarded relative date never silently uses the date of forwarding', async () => {
  const f = setup(interpreter(output(event, { attendance: 'invited', evidence: ['Dinner tomorrow at Luca'] })));
  try { f.capture('relative', { text: { body: 'Dinner tomorrow at Luca' } }); await f.worker.process(); assert.equal(f.store.events().length, 0); const p = f.store.proposals()[0]!; assert.equal(p.source, 'WhatsApp'); assert.equal(p.event.date, undefined); assert.ok(p.unresolvedFields.includes('originalDate')); } finally { f.store.close(); }
});
test('forwarded changes need original chronology; unrelated advertising creates no event', async () => {
  const f = setup(interpreter({ proposals: [] }));
  try { f.capture(); await f.worker.process(); assert.equal(f.store.proposals().length, 0); } finally { f.store.close(); }
  const a = setup();
  try {
    a.capture(); await a.worker.process(); const old = a.store.events()[0]!;
    const worker = new CalendarWorker(a.c, a.store, () => { throw Error(); }, interpreter(output(event, { action: 'cancel', targetEventId: old.id, evidence: [text] })));
    a.capture('cancel'); await worker.process(); assert.equal(a.store.events().length, 1); assert.ok(a.store.proposals().some(p => p.unresolvedFields.includes('sourceChronology')));
  } finally { a.store.close(); }
});
test('screenshot transcription is saved before extraction retries and never confirms attendance just from forwarding', async () => {
  let reads = 0; let extracts = 0; let downloads = 0;
  const f = setup({ ...interpreter(), readImage: async () => { reads++; return { text, unclear: false, reason: '' }; }, extract: async () => { extracts++; if (extracts === 1) throw Error('transient'); return result(); } }, async () => { downloads++; return 'data:image/png;base64,synthetic'; });
  try {
    f.capture('image', { type: 'image', image: { id: '333', mime_type: 'image/png' }, text: undefined }); await f.worker.process(); assert.equal(f.store.counts().failedMessages, 1);
    f.store.retryFailures(); await f.worker.process(); assert.equal(reads, 1); assert.equal(downloads, 1); assert.equal(f.store.events()[0]!.attendance, 'invited');
  } finally { f.store.close(); }
});
test('unreadable images go to Needs details; missing media access does not block text', async () => {
  const f = setup({ ...interpreter(), readImage: async () => ({ text: '', unclear: true, reason: 'Date is cropped' }) }, async () => 'data:image/png;base64,synthetic');
  try { f.capture('cropped', { type: 'image', image: { id: '333', mime_type: 'image/png' } }); await f.worker.process(); assert.equal(f.store.events().length, 0); assert.ok(f.store.proposals()[0]!.unresolvedFields.includes('attachment')); } finally { f.store.close(); }
  const a = setup(interpreter(result()), async () => { throw new WhatsAppMediaError('access'); });
  try { a.capture('image', { type: 'image', image: { id: '333', mime_type: 'image/png' } }); a.capture('text'); await a.worker.process(); assert.equal(a.store.events().length, 1); assert.equal(a.store.counts().failedMessages, 1); assert.equal(a.store.get<{reason:string}>('whatsapp_media_error')?.reason, 'access'); } finally { a.store.close(); }
});
test('backlog migration, Gmail disconnect and pruning preserve WhatsApp work and replay protection', async () => {
  const f = setup();
  try {
    captureWhatsAppMessages(f.store, parseWhatsAppMessages(payload(), f.c)); enqueueWhatsAppBacklog(f.store); enqueueWhatsAppBacklog(f.store); assert.equal(f.store.pending().length, 1);
    f.store.capture(source()); f.store.clearSources(); assert.equal(f.store.pending().length, 1);
    await f.worker.process(); f.store.db.prepare('UPDATE sources SET captured_at=?').run('2020-01-01T00:00:00Z'); f.store.pruneSources();
    assert.equal(f.store.all('whatsapp_spike_inbox').length, 0); f.capture(); assert.equal(f.store.pending().length, 0); assert.equal(f.store.events().length, 1);
  } finally { f.store.close(); }
});
test('explicit replies include only linked source context, not every message in the WhatsApp chat', () => {
  const f = setup(); try { f.capture('parent'); f.capture('unrelated'); f.capture('reply', { context: { id: 'parent' }, text: { body: 'Yes I am going' } }); const messages = f.store.pending(); assert.equal(messages[1]!.context.length, 0); assert.equal(messages[2]!.context.length, 1); assert.equal(messages[2]!.threadId, messages[0]!.threadId); assert.equal(messages[2]!.context[0]!.sentByOwner, false); } finally { f.store.close(); }
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
test('media fetch is bounded, uses Meta only, validates integrity and never follows a redirect', async () => {
  const c = cfg(); const s = { ...source(), channel: 'whatsapp' as const, whatsapp: { forwarded: true, mediaId: '333', mediaHash: createHash('sha256').update(png).digest('base64') } };
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls++; assert.equal(options?.redirect, 'error'); assert.equal((options?.headers as Record<string,string>).Authorization, 'Bearer synthetic-only');
    if (calls % 2) { assert.match(String(url), /graph.facebook.com\/v26.0\/333\?phone_number_id=123456/); return Response.json({ id: '333', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/test', mime_type: 'image/png', file_size: png.length }); }
    return new Response(png);
  };
  assert.match(await downloadWhatsAppImage(c, s, undefined, request), /^data:image\/png;base64,/); assert.equal(calls, 2);
  for (const metadata of [{ id: '333', url: 'https://evil.example/steal', mime_type: 'image/png', file_size: png.length }, { id: '333', url: 'https://lookaside.fbsbx.com/media', mime_type: 'image/png', file_size: MAX_IMAGE_BYTES + 1 }]) {
    let n = 0; await assert.rejects(downloadWhatsAppImage(c, s, undefined, async () => { n++; return Response.json(metadata); }), WhatsAppMediaError); assert.equal(n, 1);
  }
  await assert.rejects(downloadWhatsAppImage(c, { ...s, whatsapp: { ...s.whatsapp, mediaHash: 'a'.repeat(64) } }, undefined, request), WhatsAppMediaError);
});

test('disabling WhatsApp interpretation leaves its queue untouched while Gmail can still process', async () => {
  const f = setup(); try {
    f.capture(); f.store.capture(source());
    const worker = new CalendarWorker({ ...f.c, WHATSAPP_PROCESSING_ENABLED: false }, f.store, () => { throw Error(); }, interpreter());
    await worker.process(); assert.equal(f.store.events().length, 1); assert.equal(f.store.events()[0]!.source, 'Gmail'); assert.equal(f.store.pending().length, 1); assert.equal(f.store.pending()[0]!.channel, 'whatsapp');
  } finally { f.store.close(); }
});
test('an explicit dated reply can resolve one safely matched missing-date invitation', async () => {
  const f = setup(interpreter(output(event, { attendance: 'invited', evidence: ['Dinner tomorrow at Luca'] })));
  try {
    f.capture('parent', { text: { body: 'Dinner tomorrow at Luca' } }); await f.worker.process(); assert.equal(f.store.proposals()[0]!.status, 'pending');
    f.capture('reply', { context: { id: 'parent' }, text: { body: text } });
    const worker = new CalendarWorker(f.c, f.store, () => { throw Error(); }, interpreter(result())); await worker.process();
    assert.equal(f.store.events().length, 1); assert.equal(f.store.events()[0]!.attendance, 'invited'); assert.equal(f.store.proposals().filter(p => p.status === 'pending').length, 0);
  } finally { f.store.close(); }
});
