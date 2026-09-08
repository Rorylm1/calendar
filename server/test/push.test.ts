import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createECDH } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { request as HttpsRequest } from 'node:https';
import Fastify from 'fastify';
import webPush from 'web-push';
import { ZodError } from 'zod';
import { AppError } from '../src/errors.ts';
import { Store } from '../src/store.ts';
import { hash } from '../src/crypto.ts';
import { config as baseConfig, proposal, source } from './helpers.ts';
import { PUSH_BODY_LIMIT, PUSH_SETTLE_MS, PUSH_SUBSCRIPTION_LIMIT, CALENDAR_PUSH_PAYLOAD, ReviewPushWorker, createPushSender, isPublicPushAddress, pushQuietHours, registerPushRoutes, resolvePushTarget, validatePushConfig, validatePushEndpoint, validatePushSubscription, type PushConfig, type PushSend } from '../src/push.ts';

const NOW = Date.parse('2026-09-07T12:00:00Z');
function config(): PushConfig { const keys = webPush.generateVAPIDKeys(); return { ...baseConfig(), VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:notifications@example.test' }; }
function subscription(id = 'synthetic-device-1') { const key = createECDH('prime256v1'); key.generateKeys(); return { endpoint: `https://web.push.apple.com/${id}`, expirationTime: null, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; }
function addProposal(store: Store, id = 'fresh') { return store.putProposal(proposal({ event: { ...proposal().event, title: `Synthetic ${id}` } }))!; }
function fixture(send?: PushSend) {
  const cfg = config(); const store = new Store(':memory:', cfg.CALENDAR_ENCRYPTION_KEY); let now = NOW; let busy = false;
  const calls: { endpoint: string; payload: string }[] = [];
  const worker = new ReviewPushWorker(cfg, store, { now: () => now, isBusy: () => busy, send: send || (async (sub, payload) => { calls.push({ endpoint: sub.endpoint, payload }); return { statusCode: 201 }; }) });
  return { config: cfg, store, worker, calls, setTime: (value: number) => { now = value; }, advance: (value = PUSH_SETTLE_MS) => { now += value; }, setBusy: (value: boolean) => { busy = value; }, settled: async () => { await worker.tick(); now += PUSH_SETTLE_MS; await worker.tick(); }, close: async () => { await worker.stop(); store.close(); } };
}

test('push endpoint allowlist accepts browser services and rejects SSRF and ambiguous URLs', () => {
  for (const endpoint of ['https://web.push.apple.com/synthetic-token', 'https://fcm.googleapis.com/fcm/send/synthetic:token', 'https://updates.push.services.mozilla.com/wpush/v2/synthetic-token', 'https://wns2.notify.windows.com/w/?token=synthetic%2Ftoken']) assert.equal(validatePushEndpoint(endpoint).protocol, 'https:');
  for (const endpoint of ['http://web.push.apple.com/synthetic-token', 'https://web.push.apple.com:8443/synthetic-token', 'https://web.push.apple.com@127.0.0.1/synthetic-token', 'https://owner:secret@web.push.apple.com/synthetic-token', 'https://web.push.apple.com.evil.test/synthetic-token', 'https://evilpush.apple.com/synthetic-token', 'https://push.apple.com/synthetic-token', 'https://127.0.0.1/synthetic-token', 'https://[::1]/synthetic-token', 'https://fcm.googleapis.com/v1/projects/project/messages:send', 'https://web.push.apple.com/synthetic-token#hidden', 'https://web.push.apple.com/synthetic-token?redirect=https://127.0.0.1', 'https://updates.push.services.mozilla.com/wpush/v2/synthetic-token/extra', 'https://wns2.notify.windows.com/w/?token=synthetic&token=secondvalue', 'https://web.push.apple.com\\@evil.test/token', 'https://web.push.apple.com/too-big-' + 'x'.repeat(2048)]) assert.throws(() => validatePushEndpoint(endpoint), { code: 'invalid_push_endpoint' }, endpoint);
});
test('DNS validation rejects private, special-use and mixed answers before transport', async () => {
  for (const address of ['0.0.0.0', '10.2.3.4', '127.0.0.1', '169.254.169.254', '172.16.0.2', '192.168.1.1', '100.64.0.1', '192.0.2.3', '198.18.0.1', '203.0.113.5', '224.0.0.2', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fd00::1', '2001:db8::1', '2002:7f00:1::', 'garbage']) assert.equal(isPublicPushAddress(address), false, address);
  for (const address of ['8.8.8.8', '17.0.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicPushAddress(address), true, address);
  const endpoint = subscription().endpoint;
  await assert.rejects(resolvePushTarget(endpoint, async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), { code: 'unsafe_push_endpoint' });
  await assert.rejects(resolvePushTarget(endpoint, async () => []), { code: 'unsafe_push_endpoint' });
  assert.deepEqual(await resolvePushTarget(endpoint, async () => [{ address: '17.0.0.1', family: 4 }]), { hostname: 'web.push.apple.com', address: '17.0.0.1', family: 4 });
});
test('browser subscription validates real P-256 points, key lengths, expiry and field bounds', () => {
  const sub = subscription(); assert.deepEqual(validatePushSubscription(sub, NOW), sub);
  for (const invalid of [{ ...sub, expirationTime: NOW - 1 }, { ...sub, keys: { ...sub.keys, auth: 'x'.repeat(23) } }, { ...sub, keys: { ...sub.keys, p256dh: Buffer.alloc(65, 4).toString('base64url') } }, { ...sub, keys: { ...sub.keys, extra: 'unknown' } }, { ...sub, extra: 'unknown' }]) assert.throws(() => validatePushSubscription(invalid, NOW));
});
test('startup rejects partial or mismatched VAPID keys and invalid contact subjects', () => {
  const cfg = config(); validatePushConfig(cfg); validatePushConfig(baseConfig()); validatePushConfig({ ...cfg, VAPID_SUBJECT: 'https://calendar.example.com/about' });
  for (const patch of [{ VAPID_PRIVATE_KEY: '' }, { VAPID_PUBLIC_KEY: cfg.VAPID_PUBLIC_KEY + '=' }, { VAPID_PRIVATE_KEY: Buffer.alloc(32).toString('base64url') }, { VAPID_PUBLIC_KEY: webPush.generateVAPIDKeys().publicKey }, ...['http://calendar.example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://user:password@calendar.example.com', 'mailto:owner@localhost', 'mailto:owner@example.com?subject=extra', 'https://calendar.example.com/#fragment'].map(VAPID_SUBJECT => ({ VAPID_SUBJECT }))]) assert.throws(() => validatePushConfig({ ...cfg, ...patch }), /Invalid Web Push configuration/);
});
test('encrypted transport pins a public DNS answer, keeps TLS hostname, sets expiry and never follows redirects', async () => {
  let calls = 0; let sentBody: Buffer | undefined; let requestOptions: Record<string, unknown> = {};
  const request = ((options: Record<string, unknown>, callback: (response: unknown) => void) => {
    calls++; requestOptions = options; const req = new EventEmitter() as EventEmitter & { end: (body: Buffer) => void };
    req.end = body => { sentBody = body; callback({ statusCode: 307, headers: { location: 'https://127.0.0.1/private', 'retry-after': '120' }, destroy() {} }); }; return req;
  }) as unknown as typeof HttpsRequest;
  const send = createPushSender(config(), { resolve: async () => ({ hostname: 'web.push.apple.com', address: '17.0.0.1', family: 4 }), request });
  const result = await send(subscription(), JSON.stringify(CALENDAR_PUSH_PAYLOAD), new AbortController().signal);
  assert.equal(calls, 1); assert.equal(result.statusCode, 307); assert.equal(result.retryAfterMs, 120_000); assert.equal(requestOptions.hostname, '17.0.0.1'); assert.equal(requestOptions.servername, 'web.push.apple.com'); assert.equal(requestOptions.agent, false);
  const headers = requestOptions.headers as Record<string, unknown>; assert.equal(String(headers.TTL), '3600'); assert.equal(headers.Urgency, 'low'); assert.equal(headers.Topic, 'calendar-updates'); assert.match(String(headers.Authorization), /^vapid /); assert.equal(headers['Content-Encoding'], 'aes128gcm'); assert.equal(sentBody!.includes(Buffer.from(CALENDAR_PUSH_PAYLOAD.body)), false);
});
test('absolute delivery timeout includes DNS lookup and shutdown cancels unresolved delivery', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const send = createPushSender(config(), { resolve: () => new Promise(() => {}), timeoutMs: 10, request: (() => { throw new Error('No transport should run'); }) as unknown as typeof HttpsRequest });
    await assert.rejects(send(subscription(), '{}', new AbortController().signal), /aborted/);
    const controller = new AbortController(); controller.abort(); await assert.rejects(send(subscription(), '{}', controller.signal), /aborted/);
  } finally { clearTimeout(keepAlive); }
});
test('disabled backend never accepts subscriptions or attempts delivery', async () => {
  const cfg = baseConfig(); const store = new Store(':memory:', cfg.CALENDAR_ENCRYPTION_KEY); let sends = 0;
  const worker = new ReviewPushWorker(cfg, store, { send: async () => { sends++; return { statusCode: 201 }; } });
  try { assert.equal(worker.status().configured, false); assert.equal(worker.status().publicKey, null); assert.throws(() => worker.subscribe(subscription()), { code: 'push_not_configured' }); addProposal(store); await worker.tick(); assert.equal(sends, 0); } finally { await worker.stop(); store.close(); }
});
test('opt-in baselines existing items, batches new proposals and discloses no event or subscription content', async () => {
  const f = fixture(); const old = addProposal(f.store, 'existing'); const sub = subscription();
  try {
    const status = f.worker.subscribe(sub); assert.equal(status.subscriptionCount, 1); assert.deepEqual(status.subscriptionIds, [hash(sub.endpoint)]); assert.equal(JSON.stringify(status).includes(sub.endpoint), false); assert.equal(JSON.stringify(status).includes(sub.keys.auth), false);
    await f.settled(); assert.equal(f.calls.length, 0);
    addProposal(f.store, 'new-a'); addProposal(f.store, 'new-b'); await f.worker.tick(); assert.equal(f.worker.status().delivery.state, 'settling'); assert.equal(f.calls.length, 0);
    f.advance(); await f.worker.tick(); assert.equal(f.calls.length, 1); assert.deepEqual(JSON.parse(f.calls[0]!.payload), CALENDAR_PUSH_PAYLOAD); assert.equal(f.calls[0]!.payload.includes(old.event.title), false);
    for (let n = 0; n < 5; n++) { f.advance(); await f.worker.tick(); } assert.equal(f.calls.length, 1);
    const records = f.store.db.prepare("SELECT payload FROM records WHERE bucket LIKE 'push_%'").all() as { payload: string }[];
    assert.ok(records.length > 0); assert.ok(records.every(row => !row.payload.includes(sub.endpoint) && !row.payload.includes(sub.keys.auth)));
  } finally { await f.close(); }
});
test('opting in during an import baselines the active batch, then alerts for the next settled batch', async () => {
  const f = fixture();
  try {
    f.store.put('scan', 'default', { mode: 'initial' }); f.worker.subscribe(subscription()); addProposal(f.store, 'during-import');
    await f.settled(); assert.equal(f.worker.status().delivery.state, 'waiting_for_processing'); assert.equal(f.calls.length, 0);
    f.store.remove('scan'); f.store.capture(source()); addProposal(f.store, 'during-processing'); await f.settled(); assert.equal(f.calls.length, 0);
    f.store.sourceStatus('m1', 'processed'); await f.settled(); assert.equal(f.calls.length, 0);
    addProposal(f.store, 'later-mail'); await f.settled(); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('automatic additions still generate one generic alert after they leave the pending inbox', async () => {
  const f = fixture();
  try {
    f.worker.subscribe(subscription());
    for (const outcome of ['created', 'updated', 'cancelled'] as const) {
      const item = addProposal(f.store, `auto-${outcome}`);
      f.store.put('proposals', item.id, { ...item, status: 'confirmed', appliedBy: 'automatic', outcome });
    }
    await f.settled();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(JSON.parse(f.calls[0]!.payload), CALENDAR_PUSH_PAYLOAD);
    assert.equal(JSON.parse(f.calls[0]!.payload).url, '/calendar');
    f.advance(); await f.worker.tick(); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('owner actions, duplicate matches and suppressed items do not create update alerts', async () => {
  const f = fixture();
  try {
    f.worker.subscribe(subscription());
    for (const [appliedBy, outcome] of [['owner', 'created'], ['automatic', 'duplicate'], ['automatic', 'suppressed']] as const) {
      const item = addProposal(f.store, `${appliedBy}-${outcome}`);
      f.store.put('proposals', item.id, { ...item, status: 'confirmed', appliedBy, outcome });
    }
    await f.settled(); assert.equal(f.calls.length, 0);
    const item = addProposal(f.store, 'genuine-auto-addition');
    f.store.put('proposals', item.id, { ...item, status: 'confirmed', appliedBy: 'automatic', outcome: 'created' });
    await f.settled(); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('new work waits for active processing and retriable captured sources before grouping', async () => {
  const f = fixture();
  try {
    f.worker.subscribe(subscription()); addProposal(f.store); f.setBusy(true); await f.settled(); assert.equal(f.calls.length, 0);
    f.setBusy(false); f.store.capture(source()); f.store.sourceStatus('m1', 'processing'); f.store.sourceStatus('m1', 'failed'); await f.settled(); assert.equal(f.calls.length, 0);
    f.store.sourceStatus('m1', 'processed'); await f.settled(); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('London quiet hours include daylight-saving changes and defer a grouped alert until morning', async () => {
  for (const iso of ['2026-09-07T21:00:00Z', '2026-09-08T06:59:59Z', '2026-12-07T22:00:00Z', '2026-12-08T07:59:59Z']) assert.equal(pushQuietHours(Date.parse(iso)), true, iso);
  for (const iso of ['2026-09-07T20:59:59Z', '2026-09-08T07:00:00Z', '2026-12-07T21:59:59Z', '2026-12-08T08:00:00Z']) assert.equal(pushQuietHours(Date.parse(iso)), false, iso);
  const f = fixture(); try { f.worker.subscribe(subscription()); f.setTime(Date.parse('2026-09-07T22:00:00Z')); addProposal(f.store); await f.settled(); assert.equal(f.calls.length, 0); assert.equal(f.worker.status().delivery.state, 'quiet_hours'); f.setTime(Date.parse('2026-09-08T07:00:00Z')); await f.worker.tick(); assert.equal(f.calls.length, 1); } finally { await f.close(); }
});
test('reviewing candidates before delivery cancels the alert; extra devices do not receive earlier items', async () => {
  const f = fixture();
  try {
    f.worker.subscribe(subscription('first-device')); const item = addProposal(f.store); await f.worker.tick(); f.store.dismiss(item.id); f.advance(); await f.worker.tick(); assert.equal(f.calls.length, 0);
    addProposal(f.store, 'second'); await f.worker.tick(); f.worker.subscribe(subscription('second-device')); f.advance(); await f.worker.tick(); assert.equal(f.calls.length, 1); assert.match(f.calls[0]!.endpoint, /first-device$/);
  } finally { await f.close(); }
});
test('opt-out removes pending work, and re-enabling does not replay historical items', async () => {
  const f = fixture(); const sub = subscription();
  try { f.worker.subscribe(sub); addProposal(f.store); await f.worker.tick(); f.worker.unsubscribe(sub.endpoint); f.advance(); await f.worker.tick(); assert.equal(f.calls.length, 0); assert.equal(f.worker.status().enabled, false); f.worker.subscribe(sub); await f.settled(); assert.equal(f.calls.length, 0); addProposal(f.store, 'next'); await f.settled(); assert.equal(f.calls.length, 1); f.worker.unsubscribe(); assert.equal(f.worker.status().subscriptionCount, 0); assert.equal(f.store.get('push_outbox'), undefined); } finally { await f.close(); }
});
test('opt-out aborts an active delivery without resurrecting subscription or outbox', async () => {
  let started!: () => void; const begun = new Promise<void>(resolve => { started = resolve; });
  const f = fixture(async (_sub, _payload, signal) => { started(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('synthetic cancellation')), { once: true })); return { statusCode: 201 }; });
  try { f.worker.subscribe(subscription()); addProposal(f.store); await f.worker.tick(); f.advance(); const work = f.worker.tick(); await begun; f.worker.unsubscribe(); await work; assert.equal(f.worker.status().subscriptionCount, 0); assert.equal(f.store.get('push_outbox'), undefined); } finally { await f.close(); }
});
test('transient responses honor bounded backoff and end after three attempts', async () => {
  let attempts = 0; const f = fixture(async () => { attempts++; return { statusCode: 429, retryAfterMs: 180_000 }; });
  try { f.worker.subscribe(subscription()); addProposal(f.store); await f.settled(); assert.equal(attempts, 1); assert.equal(f.worker.status().delivery.lastErrorCode, 'rate_limited'); f.advance(60_000); await f.worker.tick(); assert.equal(attempts, 1); f.advance(120_000); await f.worker.tick(); assert.equal(attempts, 2); f.advance(300_000); await f.worker.tick(); assert.equal(attempts, 3); for (let n = 0; n < 5; n++) { f.advance(300_000); await f.worker.tick(); } assert.equal(attempts, 3); assert.equal(f.worker.status().delivery.state, 'failed'); } finally { await f.close(); }
});
test('permanent and expired provider responses never retry, and expired subscriptions are removed', async () => {
  for (const statusCode of [400, 401, 403, 404, 410]) {
    let attempts = 0; const f = fixture(async () => { attempts++; return { statusCode }; });
    try { f.worker.subscribe(subscription()); addProposal(f.store); await f.settled(); f.advance(300_000); await f.worker.tick(); assert.equal(attempts, 1); assert.equal(f.worker.status().subscriptionCount, [404, 410].includes(statusCode) ? 0 : 1); assert.equal(f.worker.status().delivery.lastErrorCode, [404, 410].includes(statusCode) ? 'subscription_expired' : 'provider_rejected'); } finally { await f.close(); }
  }
});
test('provider errors expose only fixed diagnostic codes and never their raw body', async () => {
  const f = fixture(async () => { throw new Error('Private endpoint secret: https://web.push.apple.com/sensitive-token'); });
  try { f.worker.subscribe(subscription()); addProposal(f.store); await f.settled(); const status = f.worker.status(); assert.equal(status.delivery.lastErrorCode, 'network_error'); assert.equal(JSON.stringify(status).includes('sensitive-token'), false); } finally { await f.close(); }
});
test('subscription count is capped, replacement is idempotent and natural expiry removes it', async () => {
  const f = fixture(); const sub = subscription();
  try { f.worker.subscribe({ ...sub, expirationTime: NOW + 60_000 }); f.worker.subscribe({ ...sub, expirationTime: NOW + 60_000 }); assert.equal(f.worker.status().subscriptionCount, 1); for (let n = 1; n < PUSH_SUBSCRIPTION_LIMIT; n++) f.worker.subscribe(subscription(`synthetic-device-${n + 1}`)); assert.throws(() => f.worker.subscribe(subscription('extra-device')), { code: 'push_device_limit' }); f.advance(60_000); await f.worker.tick(); assert.equal(f.worker.status().subscriptionCount, PUSH_SUBSCRIPTION_LIMIT - 1); } finally { await f.close(); }
});
test('successful delivery and baseline deduplication survive an encrypted database restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calendar-push-')); const path = join(dir, 'calendar.sqlite'); const cfg = config(); const sub = subscription(); let now = NOW; let sends = 0; let store = new Store(path, cfg.CALENDAR_ENCRYPTION_KEY);
  const options = { now: () => now, send: async () => { sends++; return { statusCode: 201 }; } }; let worker = new ReviewPushWorker(cfg, store, options);
  try { worker.subscribe(sub); addProposal(store); await worker.tick(); now += PUSH_SETTLE_MS; await worker.tick(); assert.equal(sends, 1); await worker.stop(); store.close(); assert.equal(readFileSync(path).includes(Buffer.from(sub.endpoint)), false); store = new Store(path, cfg.CALENDAR_ENCRYPTION_KEY); worker = new ReviewPushWorker(cfg, store, options); now += PUSH_SETTLE_MS; await worker.tick(); assert.equal(sends, 1); assert.equal(worker.status().subscriptionCount, 1); assert.ok(worker.status().delivery.lastSentAt); } finally { await worker.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('a crash after recording an in-flight send does not replay an ambiguous delivery', async () => {
  const f = fixture(); const sub = subscription();
  try { f.worker.subscribe(sub); const item = addProposal(f.store); f.store.put('push_metadata', 'default', { observedIds: [item.id], candidateIds: [], changedAt: NOW, lastSentAt: null, lastErrorCode: null }); f.store.put('push_outbox', 'default', { id: 'interrupted-batch', proposalIds: [item.id], createdAt: NOW, expiresAt: NOW + 3_600_000, deliveries: { [hash(sub.endpoint)]: { state: 'sending', attempts: 1, nextAttemptAt: NOW, error: null } } }); await f.worker.tick(); assert.equal(f.calls.length, 0); assert.equal(f.worker.status().delivery.lastErrorCode, 'delivery_unknown'); } finally { await f.close(); }
});
test('notification routes enforce their API schema and body limits without network calls', async () => {
  const f = fixture(); const app = Fastify(); const worker = registerPushRoutes(app, f.config, f.store, { now: () => NOW, send: async () => { throw new Error('No route may send a push'); } });
  app.setErrorHandler((error, _request, reply) => reply.status(error instanceof AppError ? error.status : error instanceof ZodError ? 400 : (error as { statusCode?: number }).statusCode || 500).send({ failed: true }));
  try { const sub = subscription(); assert.equal((await app.inject('/v1/notifications')).json().enabled, false); assert.equal((await app.inject({ method: 'POST', url: '/v1/notifications', payload: { subscription: sub } })).statusCode, 200); assert.equal((await app.inject({ method: 'POST', url: '/v1/notifications', payload: { subscription: sub, permission: 'granted' } })).statusCode, 400); assert.equal((await app.inject({ method: 'POST', url: '/v1/notifications', payload: { content: 'x'.repeat(PUSH_BODY_LIMIT) } })).statusCode, 413); assert.equal((await app.inject({ method: 'DELETE', url: '/v1/notifications', payload: {} })).json().subscriptionCount, 0); } finally { await worker.stop(); await app.close(); await f.close(); }
});
