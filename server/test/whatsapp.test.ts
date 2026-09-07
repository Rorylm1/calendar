import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.ts';
import { readConfig, whatsappConfigured } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { captureWhatsAppMessages, parseWhatsAppMessages, readWhatsAppInbox, WHATSAPP_BODY_LIMIT, WHATSAPP_INBOX_LIMIT } from '../src/whatsapp.ts';
import { config as baseConfig, fields } from './helpers.ts';

const whatsappConfig = () => ({ ...baseConfig(), WHATSAPP_APP_SECRET: 'synthetic-app-secret-at-least-32-characters', WHATSAPP_VERIFY_TOKEN: 'synthetic-verify-token-at-least-32-characters', WHATSAPP_OWNER_SENDER_ID: '447700900123', WHATSAPP_PHONE_NUMBER_ID: '10000000001' });
const message = (patch: Record<string, unknown> = {}) => ({ id: 'wamid.synthetic-message-1', from: '447700900123', timestamp: '1788782400', type: 'text', text: { body: 'Dinner at Café Example on Saturday — are you coming?' }, ...patch });
const envelope = (messages: unknown[] = [message()], receiver = '10000000001') => ({ object: 'whatsapp_business_account', entry: [{ id: 'synthetic-business-account', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: receiver }, messages } }] }] });
const signature = (body: Buffer | string, secret = whatsappConfig().WHATSAPP_APP_SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
function fixture(enabled = true, externalStore?: Store) {
  const config = enabled ? whatsappConfig() : baseConfig(); const store = externalStore || new Store(':memory:', config.CALENDAR_ENCRYPTION_KEY);
  const { app } = buildApp(config, { store, schedule: false });
  const post = (body: unknown = envelope(), headers: Record<string, string> = {}) => {
    const raw = Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body);
    return app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(raw, config.WHATSAPP_APP_SECRET), ...headers }, payload: raw });
  };
  const close = async () => { await app.close(); if (!externalStore) store.close(); };
  return { app, config, store, post, close };
}
test('WhatsApp remains disabled with missing or partial configuration', async () => {
  const config = readConfig({ CALENDAR_SERVICE_TOKEN: 'x'.repeat(32), CALENDAR_ENCRYPTION_KEY: 'a'.repeat(64), GMAIL_ALLOWED_EMAIL: 'owner@example.test' });
  assert.equal(whatsappConfigured(config), false); assert.equal(whatsappConfigured({ ...config, WHATSAPP_APP_SECRET: 's'.repeat(32) }), false);
  const f = fixture(false); try { assert.equal((await f.post()).statusCode, 404); assert.equal((await f.app.inject('/webhooks/whatsapp?hub.mode=subscribe')).statusCode, 404); assert.equal(readWhatsAppInbox(f.store).total, 0); } finally { await f.close(); }
});
test('GET verification returns the exact challenge only with an unambiguous matching token', async () => {
  const f = fixture(); const token = f.config.WHATSAPP_VERIFY_TOKEN;
  try {
    const result = await f.app.inject(`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=000123`); assert.equal(result.statusCode, 200); assert.equal(result.body, '000123'); assert.match(result.headers['content-type'] as string, /text\/plain/);
    for (const query of [`hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`, `hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1&hub.challenge=2`, `hub.mode=unsubscribe&hub.verify_token=${token}&hub.challenge=1`]) assert.equal((await f.app.inject(`/webhooks/whatsapp?${query}`)).statusCode, 403);
  } finally { await f.close(); }
});
test('HMAC verifies exact UTF-8 bytes before JSON parsing and rejects altered or malformed signatures', async () => {
  const f = fixture(); const raw = JSON.stringify(envelope(), null, 2);
  try {
    assert.equal((await f.post(raw)).statusCode, 200);
    assert.equal((await f.post(raw + ' ', { 'x-hub-signature-256': signature(raw) })).statusCode, 401);
    for (const value of ['', 'sha1=' + 'a'.repeat(64), 'sha256=abcd', 'sha256=' + 'g'.repeat(64), signature(raw) + ', ' + signature(raw), signature(raw, 'wrong-secret')]) assert.equal((await f.post(raw, { 'x-hub-signature-256': value })).statusCode, 401);
    assert.equal((await f.post('{', { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })).statusCode, 401);
    assert.equal((await f.post('{')).statusCode, 400);
    assert.equal((await f.post(Buffer.from([0xff, 0xfe]))).statusCode, 400);
    assert.equal(readWhatsAppInbox(f.store).total, 1);
  } finally { await f.close(); }
});
test('accepted text is encrypted durably before200 and keeps forwarding uncertainty separate from Gmail', async () => {
  const f = fixture();
  try {
    const result = await f.post(envelope([message({ context: { forwarded: true, frequently_forwarded: true, id: 'wamid.reply-target', from: 'synthetic-reply-sender' } })])); assert.equal(result.statusCode, 200);
    const item = readWhatsAppInbox(f.store).items[0]!; assert.equal(item.source, 'WhatsApp'); assert.equal(item.channel, 'whatsapp_cloud_api'); assert.equal(item.status, 'captured'); assert.match(item.text!, /Café/);
    assert.deepEqual(item.forwarding, { forwarded: true, frequentlyForwarded: true, originalSender: null, originalSentAt: null }); assert.equal(item.context.replyToMessageId, 'wamid.reply-target'); assert.ok(item.receivedAt); assert.equal(item.sentAt, '2026-09-07T12:00:00.000Z');
    const row = f.store.db.prepare("SELECT id,payload FROM records WHERE bucket='whatsapp_spike_inbox'").get() as { id: string; payload: string }; assert.match(row.id, /^[a-f0-9]{64}$/); assert.equal(row.payload.includes('Café'), false); assert.equal(row.payload.includes(f.config.WHATSAPP_OWNER_SENDER_ID), false);
    assert.equal(f.store.pending().length, 0); assert.equal(f.store.events().length, 0); assert.equal(f.store.proposals().length, 0);
  } finally { await f.close(); }
});
test('replays and changed duplicate deliveries preserve the first message and count once', async () => {
  const f = fixture();
  try {
    assert.equal((await f.post()).statusCode, 200); assert.equal((await f.post()).statusCode, 200); assert.equal((await f.post(envelope([message({ text: { body: 'Different content with the same ID' } })]))).statusCode, 200);
    const inbox = readWhatsAppInbox(f.store); assert.equal(inbox.total, 1); assert.match(inbox.items[0]!.text!, /Café/);
    const status = await f.app.inject({ url: '/v1/whatsapp/status', headers: { authorization: `Bearer ${f.config.CALENDAR_SERVICE_TOKEN}` } }); assert.equal(status.json().capturedMessages, 1);
  } finally { await f.close(); }
});
test('wrong sender and wrong receiving number are ignored without retaining their content', async () => {
  const f = fixture();
  try {
    assert.equal((await f.post(envelope([message({ from: '447700900999' })]))).statusCode, 200);
    assert.equal((await f.post(envelope([message()], '10000000999'))).statusCode, 200);
    assert.equal(readWhatsAppInbox(f.store).total, 0);
    assert.equal((await f.post(envelope([message({ from: '447700900999' }), message()]))).statusCode, 200); assert.equal(readWhatsAppInbox(f.store).total, 1);
  } finally { await f.close(); }
});
test('signed status callbacks are harmless, and media is recorded without fetching or interpreting', async () => {
  const f = fixture(); const originalFetch = globalThis.fetch; let networkCalls = 0; globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected outbound call'); };
  try {
    const statuses = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: f.config.WHATSAPP_PHONE_NUMBER_ID }, statuses: [{ id: 'wamid.outbound', status: 'delivered' }] } }] }] };
    assert.equal((await f.post(statuses)).statusCode, 200); assert.equal(readWhatsAppInbox(f.store).total, 0);
    assert.equal((await f.post(envelope([message({ type: 'document', document: { id: 'media-id', mime_type: 'application/pdf', filename: 'booking.pdf', url: 'https://untrusted.example/private' } })]))).statusCode, 200);
    const item = readWhatsAppInbox(f.store).items[0]!; assert.equal(item.status, 'unsupported'); assert.equal(item.text, undefined); assert.equal(item.media?.filename, 'booking.pdf'); assert.equal(JSON.stringify(item).includes('untrusted.example'), false); assert.equal(item.unsupportedReason, 'message_type_not_supported'); assert.equal(networkCalls, 0); assert.equal(f.store.proposals().length, 0);
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});
test('unknown message kinds and oversized text stay explicit unsupported inbox items', async () => {
  const f = fixture();
  try {
    assert.equal((await f.post(envelope([message({ id: 'unknown', type: 'future_type', future_type: { opaque: 'unreadable' } }), message({ id: 'large-text', text: { body: '😀'.repeat(4097) } })]))).statusCode, 200);
    const items = readWhatsAppInbox(f.store).items; assert.equal(items.length, 2); assert.ok(items.every(item => item.status === 'unsupported' && item.text === undefined)); assert.ok(items.some(item => item.unsupportedReason === 'invalid_or_oversized_text'));
  } finally { await f.close(); }
});
test('request and batch bounds reject excess payloads without partial persistence', async () => {
  const f = fixture();
  try {
    assert.equal((await f.post('x'.repeat(WHATSAPP_BODY_LIMIT + 1))).statusCode, 413);
    assert.equal((await f.post(envelope(Array.from({ length: 51 }, (_, i) => message({ id: `batch-${i}` }))))).statusCode, 400);
    const mixed = envelope(); mixed.entry.push(...envelope(Array.from({ length: 50 }, (_, i) => message({ id: `batch-${i}` }))).entry); assert.equal((await f.post(mixed)).statusCode, 413);
    assert.equal((await f.post(envelope([message(), message({ id: 'bad', timestamp: '9999999999999' })]))).statusCode, 400); assert.equal(readWhatsAppInbox(f.store).total, 0);
  } finally { await f.close(); }
});
test('a failed durable write is never acknowledged as successful', async () => {
  const f = fixture(); const transaction = f.store.transaction.bind(f.store); f.store.transaction = () => { throw new Error('Synthetic disk failure'); };
  try { assert.equal((await f.post()).statusCode, 500); assert.equal(readWhatsAppInbox(f.store).total, 0); f.store.transaction = transaction; assert.equal((await f.post()).statusCode, 200); } finally { await f.close(); }
});
test('inbox capacity rolls back the entire batch and duplicate replay remains safe at capacity', () => {
  const config = whatsappConfig(); const store = new Store(':memory:', config.CALENDAR_ENCRYPTION_KEY);
  try {
    const seed = parseWhatsAppMessages(envelope(), config)[0]!;
    captureWhatsAppMessages(store, Array.from({ length: WHATSAPP_INBOX_LIMIT - 1 }, (_, i) => ({ ...seed, id: `synthetic-${i}` })));
    assert.throws(() => captureWhatsAppMessages(store, [{ ...seed, id: 'new-1' }, { ...seed, id: 'new-2' }]), /needs attention/); assert.equal(readWhatsAppInbox(store).total, WHATSAPP_INBOX_LIMIT - 1);
    captureWhatsAppMessages(store, [{ ...seed, id: 'last' }]); captureWhatsAppMessages(store, [{ ...seed, id: 'last' }]); assert.equal(readWhatsAppInbox(store).total, WHATSAPP_INBOX_LIMIT);
  } finally { store.close(); }
});
test('inbox and deduplication survive service and database restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calendar-whatsapp-')); const path = join(dir, 'calendar.sqlite'); const config = whatsappConfig(); let store = new Store(path, config.CALENDAR_ENCRYPTION_KEY);
  try {
    captureWhatsAppMessages(store, parseWhatsAppMessages(envelope(), config)); store.close();
    assert.equal(readFileSync(path).includes(Buffer.from('Café')), false);
    store = new Store(path, config.CALENDAR_ENCRYPTION_KEY); captureWhatsAppMessages(store, parseWhatsAppMessages(envelope(), config)); assert.equal(readWhatsAppInbox(store).total, 1); assert.match(readWhatsAppInbox(store).items[0]!.text!, /Café/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('public webhook exemption never opens v1 routes and leaves ordinary JSON parsing intact', async () => {
  const f = fixture();
  try {
    for (const url of ['/v1/state', '/v1/whatsapp/status', '/v1/whatsapp/inbox', '/webhooks/whatsapp/not-a-route']) assert.equal((await f.app.inject(url)).statusCode, 401);
    const result = await f.app.inject({ method: 'POST', url: '/v1/events', headers: { authorization: `Bearer ${f.config.CALENDAR_SERVICE_TOKEN}` }, payload: fields() }); assert.equal(result.statusCode, 201);
    await f.post(envelope([message({ context: { forwarded: true } })]));
    const status = await f.app.inject({ url: '/v1/whatsapp/status', headers: { authorization: `Bearer ${f.config.CALENDAR_SERVICE_TOKEN}` } }); assert.equal(status.statusCode, 200); assert.equal(status.json().forwardedMessages, 1); assert.equal(status.json().processingEnabled, false); assert.equal(status.json().repliesEnabled, false); assert.equal(status.body.includes('Café'), false); assert.equal(status.body.includes(f.config.WHATSAPP_OWNER_SENDER_ID), false); assert.equal(status.body.includes(f.config.WHATSAPP_APP_SECRET), false);
  } finally { await f.close(); }
});
