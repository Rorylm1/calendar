import { ECDH, createECDH, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import webPush, { type PushSubscription } from 'web-push';
import { z } from 'zod';
import type { Config } from './config.ts';
import { hash } from './crypto.ts';
import { AppError } from './errors.ts';
import { Store } from './store.ts';

export const PUSH_SUBSCRIPTION_LIMIT = 5;
export const PUSH_BODY_LIMIT = 4096;
export const PUSH_SETTLE_MS = 120_000;
export const PUSH_TIMEOUT_MS = 10_000;
const HOUR = 3_600_000;
const SUBSCRIPTIONS = 'push_subscriptions';
const META = 'push_metadata';
const OUTBOX = 'push_outbox';
export const REVIEW_PUSH_PAYLOAD = Object.freeze({ title: 'Edge', body: 'New plans are ready to review.', url: '/calendar?review=1', tag: 'calendar-review', renotify: false });
export type PushConfig = Config & { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
type DeliveryCode = 'subscription_expired' | 'provider_rejected' | 'provider_unavailable' | 'rate_limited' | 'network_error' | 'unsafe_endpoint' | 'delivery_unknown' | 'delivery_expired' | 'service_error';
type Device = { id: string; subscription: PushSubscription; baselineIds: string[]; baselineWhileBusy: boolean };
type Delivery = { state: 'pending' | 'sending' | 'sent' | 'failed'; attempts: number; nextAttemptAt: number; error: DeliveryCode | null };
type Batch = { id: string; proposalIds: string[]; createdAt: number; expiresAt: number; deliveries: Record<string, Delivery> };
type Metadata = { observedIds: string[]; candidateIds: string[]; changedAt: number; lastSentAt: string | null; lastErrorCode: DeliveryCode | null };
export type PushSend = (subscription: PushSubscription, payload: string, signal: AbortSignal) => Promise<{ statusCode: number; retryAfterMs?: number }>;
export type PushOptions = { now?: () => number; isBusy?: () => boolean; send?: PushSend };
export const pushConfigured = (config: PushConfig) => Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT);
export function validatePushConfig(config: PushConfig): void {
  const values = [config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY, config.VAPID_SUBJECT];
  if (values.every(value => !value)) return;
  const fail = () => new Error('Invalid Web Push configuration. Set a matching VAPID key pair and a valid HTTPS or mailto contact together.');
  if (!values.every(Boolean)) throw fail();
  try {
    const publicKey = config.VAPID_PUBLIC_KEY!; const privateKey = config.VAPID_PRIVATE_KEY!; const subject = config.VAPID_SUBJECT!;
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey) || /[\s\\]/.test(subject) || subject.length > 512) throw fail();
    const publicBytes = Buffer.from(publicKey, 'base64url'); const privateBytes = Buffer.from(privateKey, 'base64url');
    if (publicBytes.toString('base64url') !== publicKey || privateBytes.toString('base64url') !== privateKey || publicBytes.length !== 65 || privateBytes.length !== 32 || publicBytes[0] !== 4) throw fail();
    const curve = createECDH('prime256v1'); curve.setPrivateKey(privateBytes);
    if (!timingSafeEqual(curve.getPublicKey(), publicBytes)) throw fail();
    const url = new URL(subject);
    if (url.hash || url.username || url.password) throw fail();
    if (url.protocol === 'mailto:') {
      if (url.search || !/^[^@<>]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(url.pathname)) throw fail();
    } else if (url.protocol !== 'https:' || url.port || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublicPushAddress(url.hostname.replace(/^\[|\]$/g, '')))) throw fail();
  } catch { throw fail(); }
}

export function validatePushEndpoint(endpoint: string): URL {
  const bad = () => new AppError('invalid_push_endpoint', 'This browser push service is not supported.', 400);
  if (endpoint.length > 2048 || /[\s\\]/.test(endpoint)) throw bad();
  let url: URL; try { url = new URL(endpoint); } catch { throw bad(); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw bad();
  const token = '[A-Za-z0-9_~.:-]{8,}';
  const apple = /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname) && new RegExp(`^/${token}$`).test(url.pathname) && !url.search;
  const google = url.hostname === 'fcm.googleapis.com' && new RegExp(`^/fcm/send/${token}$`).test(url.pathname) && !url.search;
  const firefox = url.hostname === 'updates.push.services.mozilla.com' && new RegExp(`^/wpush/v[12]/${token}$`).test(url.pathname) && !url.search;
  const windows = /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname) && ['/', '/w/'].includes(url.pathname) && [...url.searchParams.keys()].length === 1 && url.searchParams.has('token') && (url.searchParams.get('token')?.length || 0) >= 8;
  if (!apple && !google && !firefox && !windows) throw bad();
  return url;
}
const Subscription = z.object({ endpoint: z.string().min(1).max(2048), expirationTime: z.number().finite().nonnegative().nullable().optional(), keys: z.object({ p256dh: z.string().min(86).max(88), auth: z.string().min(22).max(24) }).strict() }).strict();
export function validatePushSubscription(input: unknown, now = Date.now()): PushSubscription {
  const value = Subscription.parse(input); validatePushEndpoint(value.endpoint);
  if (value.expirationTime != null && value.expirationTime <= now) throw new AppError('expired_push_subscription', 'Enable notifications again in this browser.', 400);
  try {
    for (const [key, bytes] of [[value.keys.p256dh, 65], [value.keys.auth, 16]] as const) {
      if (!/^[A-Za-z0-9_-]+={0,2}$/.test(key) || Buffer.from(key, 'base64url').length !== bytes || Buffer.from(key, 'base64url').toString('base64url') !== key.replace(/=+$/, '')) throw new Error();
    }
    const publicKey = Buffer.from(value.keys.p256dh, 'base64url');
    if (publicKey[0] !== 4) throw new Error();
    ECDH.convertKey(publicKey, 'prime256v1', undefined, undefined, 'uncompressed');
  } catch { throw new AppError('invalid_push_keys', 'This browser returned invalid notification keys.', 400); }
  return value;
}

const blocked4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked4.addSubnet(address, prefix, 'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new BlockList(); for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked6.addSubnet(address, prefix, 'ipv6');
export function isPublicPushAddress(address: string) { const family = isIP(address); return family === 4 ? !blocked4.check(address, 'ipv4') : family === 6 && global6.check(address, 'ipv6') && !blocked6.check(address, 'ipv6'); }
type Lookup = (hostname: string) => Promise<{ address: string; family: number }[]>;
export async function resolvePushTarget(endpoint: string, lookup: Lookup = hostname => dnsLookup(hostname, { all: true, verbatim: true })) {
  const url = validatePushEndpoint(endpoint); const addresses = await lookup(url.hostname);
  if (!addresses.length || addresses.some(item => ![4, 6].includes(item.family) || isIP(item.address) !== item.family || !isPublicPushAddress(item.address))) throw new AppError('unsafe_push_endpoint', 'The browser push service could not be reached safely.', 400);
  return { hostname: url.hostname, ...addresses[0]! };
}

// The library supplies standard encryption and VAPID. Our transport pins the
// validated DNS answer, forbids redirects, and has an absolute deadline.
export function createPushSender(config: PushConfig, transport: { resolve?: typeof resolvePushTarget; request?: typeof httpsRequest; timeoutMs?: number } = {}): PushSend {
  return async (subscription, payload, callerSignal) => {
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(transport.timeoutMs ?? PUSH_TIMEOUT_MS)]);
    const target = await new Promise<Awaited<ReturnType<typeof resolvePushTarget>>>((resolve, reject) => {
      const abort = () => reject(new Error('Push request aborted'));
      if (signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, { once: true });
      void (transport.resolve || resolvePushTarget)(subscription.endpoint).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    const details = webPush.generateRequestDetails(subscription, payload, { vapidDetails: { publicKey: config.VAPID_PUBLIC_KEY!, privateKey: config.VAPID_PRIVATE_KEY!, subject: config.VAPID_SUBJECT! }, contentEncoding: 'aes128gcm', TTL: 3600, urgency: 'low', topic: 'calendar-review' });
    return new Promise((resolve, reject) => {
      const url = validatePushEndpoint(details.endpoint);
      const req = (transport.request || httpsRequest)({ hostname: target.address, family: target.family, servername: target.hostname, port: 443, method: 'POST', path: url.pathname + url.search, headers: { ...details.headers, Host: target.hostname }, agent: false, signal }, response => {
        const retry = response.headers['retry-after']; let retryAfterMs = 0;
        if (typeof retry === 'string') retryAfterMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
        resolve({ statusCode: response.statusCode || 0, retryAfterMs: Number.isFinite(retryAfterMs) ? Math.min(HOUR, retryAfterMs) : 0 });
        response.destroy(); // No endpoint response body is retained or logged.
      });
      req.on('error', reject); req.end(details.body);
    });
  };
}

export function pushQuietHours(now: number) { const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(now)); return hour >= 22 || hour < 8; }
function blankMetadata(ids: string[] = []): Metadata { return { observedIds: ids, candidateIds: [], changedAt: 0, lastSentAt: null, lastErrorCode: null }; }
export class ReviewPushWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private operation?: AbortController;
  private stopped = false;
  private readonly now: () => number;
  private readonly send: PushSend;
  constructor(private config: PushConfig, private store: Store, private options: PushOptions = {}) { validatePushConfig(config); this.now = options.now || Date.now; this.send = options.send || createPushSender(config); }
  private devices() { return this.store.all<Device>(SUBSCRIPTIONS); }
  private metadata() { return this.store.get<Metadata>(META) || blankMetadata(); }
  private busy() {
    if (this.options.isBusy?.() || this.store.get('scan')) return true;
    return Boolean(this.store.db.prepare("SELECT 1 FROM sources WHERE status IN ('fetched','processing') OR (status='failed' AND attempts<3) LIMIT 1").get());
  }
  status() {
    const devices = this.devices(); const meta = this.metadata(); const batch = this.store.get<Batch>(OUTBOX);
    const outstanding = Object.values(batch?.deliveries || {}).filter(item => item.state === 'pending' || item.state === 'sending');
    const lastErrorCode = Object.values(batch?.deliveries || {}).find(item => item.error)?.error || meta.lastErrorCode;
    const state = !pushConfigured(this.config) || !devices.length ? 'disabled' : this.busy() ? 'waiting_for_processing' : pushQuietHours(this.now()) ? 'quiet_hours' : outstanding.some(item => item.state === 'sending') ? 'sending' : outstanding.some(item => item.attempts > 0) ? 'retrying' : outstanding.length ? 'queued' : meta.candidateIds.length ? 'settling' : lastErrorCode ? 'failed' : meta.lastSentAt ? 'sent' : 'idle';
    return { configured: pushConfigured(this.config), publicKey: pushConfigured(this.config) ? this.config.VAPID_PUBLIC_KEY! : null, enabled: devices.length > 0, subscriptionCount: devices.length, subscriptionIds: devices.map(item => item.id), delivery: { state, lastSentAt: meta.lastSentAt, lastErrorCode, nextAttemptAt: outstanding.length ? new Date(Math.min(...outstanding.map(item => item.nextAttemptAt))).toISOString() : null }, quietHours: { start: 22, end: 8, timeZone: 'Europe/London' } };
  }
  subscribe(input: unknown) {
    if (!pushConfigured(this.config)) throw new AppError('push_not_configured', 'Review notifications are not available yet.', 409);
    const subscription = validatePushSubscription(input, this.now()); const id = hash(subscription.endpoint);
    this.store.transaction(() => {
      const devices = this.devices(); const old = devices.find(item => item.id === id);
      if (!old && devices.length >= PUSH_SUBSCRIPTION_LIMIT) throw new AppError('push_device_limit', 'Turn off notifications on another device before adding this one.', 409);
      const ids = this.store.proposals().map(item => item.id);
      if (!devices.length) { this.store.put(META, 'default', blankMetadata(ids)); this.store.remove(OUTBOX); }
      this.store.put(SUBSCRIPTIONS, id, { id, subscription, baselineIds: old?.baselineIds || ids, baselineWhileBusy: old?.baselineWhileBusy ?? this.busy() } satisfies Device);
    }); return this.status();
  }
  unsubscribe(endpoint?: string) {
    this.operation?.abort();
    this.store.transaction(() => {
      const ids = endpoint ? [hash(endpoint)] : this.devices().map(item => item.id);
      const batch = this.store.get<Batch>(OUTBOX);
      for (const id of ids) { this.store.remove(SUBSCRIPTIONS, id); if (batch) delete batch.deliveries[id]; }
      if (!this.devices().length) { this.store.remove(OUTBOX); this.store.put(META, 'default', blankMetadata(this.store.proposals().map(item => item.id))); }
      else if (batch) this.store.put(OUTBOX, 'default', batch);
    }); return this.status();
  }
  start() { if (this.timer || this.active) return; this.stopped = false; const loop = () => { if (this.stopped) return; this.timer = setTimeout(() => { this.timer = undefined; void this.tick().finally(loop); }, 60_000); this.timer.unref(); }; loop(); }
  async stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.operation?.abort(); await this.active; }
  tick(): Promise<void> {
    if (this.active) return this.active;
    if (this.stopped || !pushConfigured(this.config)) return Promise.resolve();
    this.operation = new AbortController();
    this.active = this.run(this.operation.signal).catch(() => { const meta = this.metadata(); meta.lastErrorCode = 'service_error'; this.store.put(META, 'default', meta); }).finally(() => { this.active = undefined; this.operation = undefined; });
    return this.active;
  }
  private async run(signal: AbortSignal) {
    const now = this.now();
    for (const device of this.devices()) if (device.subscription.expirationTime != null && device.subscription.expirationTime <= now) this.removeDevice(device.id);
    if (!this.devices().length) return;
    const proposals = this.store.proposals(); const ids = proposals.map(item => item.id); const pending = new Set(proposals.filter(item => item.status === 'pending').map(item => item.id));
    const busy = this.busy();
    for (const device of this.devices()) if (device.baselineWhileBusy) { device.baselineIds = ids; device.baselineWhileBusy = busy; this.store.put(SUBSCRIPTIONS, device.id, device); }
    const meta = this.metadata(); const seen = new Set(meta.observedIds);
    const candidates = [...pending].filter(id => !seen.has(id)).sort();
    if (JSON.stringify(candidates) !== JSON.stringify(meta.candidateIds) || busy) { meta.candidateIds = candidates; meta.changedAt = now; this.store.put(META, 'default', meta); }
    // A saved in-flight request may already have reached the provider. Do not
    // replay it after a process crash: a missed generic alert is preferable.
    let batch = this.store.get<Batch>(OUTBOX);
    if (batch) {
      for (const delivery of Object.values(batch.deliveries)) if (delivery.state === 'sending') { delivery.state = 'failed'; delivery.error = 'delivery_unknown'; meta.lastErrorCode = 'delivery_unknown'; }
      for (const [id, delivery] of Object.entries(batch.deliveries)) {
        if (!this.store.get<Device>(SUBSCRIPTIONS, id)) delete batch.deliveries[id];
        else if (delivery.state === 'pending' && (batch.expiresAt <= now || !batch.proposalIds.some(id => pending.has(id)))) { delivery.state = 'failed'; delivery.error = batch.expiresAt <= now ? 'delivery_expired' : null; }
      }
      this.store.put(OUTBOX, 'default', batch); this.store.put(META, 'default', meta);
      if (!Object.values(batch.deliveries).some(item => item.state === 'pending')) { this.store.remove(OUTBOX); batch = undefined; }
    }
    if (busy || pushQuietHours(now)) return;
    if (!batch && candidates.length && now - meta.changedAt >= PUSH_SETTLE_MS) {
      const deliveries: Batch['deliveries'] = {};
      for (const device of this.devices()) if (candidates.some(id => !device.baselineIds.includes(id))) deliveries[device.id] = { state: 'pending', attempts: 0, nextAttemptAt: now, error: null };
      batch = { id: randomUUID(), proposalIds: candidates, createdAt: now, expiresAt: now + HOUR, deliveries };
      meta.observedIds = [...new Set([...meta.observedIds, ...ids])]; meta.candidateIds = []; meta.lastErrorCode = null;
      this.store.transaction(() => { this.store.put(META, 'default', meta); this.store.put(OUTBOX, 'default', batch); });
    }
    if (!batch) return;
    for (const id of Object.keys(batch.deliveries)) {
      if (signal.aborted || this.stopped || this.busy() || pushQuietHours(this.now())) return;
      const fresh = this.store.get<Batch>(OUTBOX); const device = this.store.get<Device>(SUBSCRIPTIONS, id); const delivery = fresh?.deliveries[id];
      if (!fresh || !device || !delivery || delivery.state !== 'pending' || delivery.nextAttemptAt > this.now()) continue;
      if (!this.store.proposals().some(item => item.status === 'pending' && fresh.proposalIds.includes(item.id))) { delivery.state = 'failed'; delivery.error = null; this.store.put(OUTBOX, 'default', fresh); continue; }
      delivery.state = 'sending'; delivery.attempts++; this.store.put(OUTBOX, 'default', fresh);
      let result: Awaited<ReturnType<PushSend>> | undefined; let failure: DeliveryCode | undefined;
      try { result = await this.send(device.subscription, JSON.stringify(REVIEW_PUSH_PAYLOAD), signal); }
      catch (error) { failure = error instanceof AppError && ['unsafe_push_endpoint', 'invalid_push_endpoint'].includes(error.code) ? 'unsafe_endpoint' : signal.aborted ? 'delivery_unknown' : 'network_error'; }
      const saved = this.store.get<Batch>(OUTBOX); if (!saved || saved.id !== fresh.id || !saved.deliveries[id] || !this.store.get(SUBSCRIPTIONS, id)) continue;
      const entry = saved.deliveries[id]; const latest = this.metadata(); const status = result?.statusCode || 0;
      if ([404, 410].includes(status)) { this.removeDevice(id); latest.lastErrorCode = 'subscription_expired'; }
      else if (status >= 200 && status < 300) { entry.state = 'sent'; entry.error = null; latest.lastSentAt = new Date(this.now()).toISOString(); latest.lastErrorCode = null; this.store.put(OUTBOX, 'default', saved); }
      else {
        entry.error = failure || (status === 429 ? 'rate_limited' : status >= 500 || status === 408 ? 'provider_unavailable' : 'provider_rejected'); latest.lastErrorCode = entry.error;
        const retryable = failure === 'network_error' || [408, 429].includes(status) || status >= 500;
        entry.state = retryable && entry.attempts < 3 && saved.expiresAt > this.now() && !signal.aborted ? 'pending' : 'failed';
        entry.nextAttemptAt = this.now() + Math.max(Math.min(HOUR, result?.retryAfterMs || 0), entry.attempts === 1 ? 60_000 : 300_000);
        this.store.put(OUTBOX, 'default', saved);
      }
      this.store.put(META, 'default', latest);
    }
  }
  private removeDevice(id: string) { this.store.remove(SUBSCRIPTIONS, id); const batch = this.store.get<Batch>(OUTBOX); if (batch) { delete batch.deliveries[id]; this.store.put(OUTBOX, 'default', batch); } }
}

export function registerPushRoutes(app: FastifyInstance, config: PushConfig, store: Store, options: PushOptions = {}) {
  const worker = new ReviewPushWorker(config, store, options);
  app.get('/v1/notifications', async () => worker.status());
  app.post('/v1/notifications', { bodyLimit: PUSH_BODY_LIMIT }, async request => { const body = z.object({ subscription: z.unknown() }).strict().parse(request.body); return worker.subscribe(body.subscription); });
  app.delete('/v1/notifications', { bodyLimit: PUSH_BODY_LIMIT }, async request => { const body = z.object({ endpoint: z.string().min(1).max(2048).optional() }).strict().parse(request.body || {}); if (body.endpoint) validatePushEndpoint(body.endpoint); return worker.unsubscribe(body.endpoint); });
  return worker;
}
