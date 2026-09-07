import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Config, whatsappConfigured } from './config.ts';
import { hash, safeEqual } from './crypto.ts';
import { AppError } from './errors.ts';
import { Store } from './store.ts';

export const WHATSAPP_BODY_LIMIT = 128 * 1024;
export const WHATSAPP_BATCH_LIMIT = 50;
export const WHATSAPP_INBOX_LIMIT = 1000;
const bucket = 'whatsapp_spike_inbox';
type WhatsAppStats = { capturedMessages: number; unsupportedMessages: number; forwardedMessages: number; frequentlyForwardedMessages: number; lastReceivedAt: string | null };
const emptyStats = (): WhatsAppStats => ({ capturedMessages: 0, unsupportedMessages: 0, forwardedMessages: 0, frequentlyForwardedMessages: 0, lastReceivedAt: null });
const id = z.string().min(1).max(512);
const Context = z.object({ id: id.optional(), from: z.string().max(128).optional(), forwarded: z.boolean().optional(), frequently_forwarded: z.boolean().optional() });
const Message = z.object({ id, from: z.string().min(1).max(128), timestamp: z.string().regex(/^\d{1,13}$/), type: z.string().min(1).max(40), context: Context.optional() });
const Envelope = z.object({ object: z.literal('whatsapp_business_account'), entry: z.array(z.object({ id: z.string().max(128).optional(), changes: z.array(z.object({ field: z.string().max(80), value: z.unknown() })).max(50) })).max(50) });
const Value = z.object({ messaging_product: z.literal('whatsapp'), metadata: z.object({ phone_number_id: z.string().max(128) }), messages: z.array(z.unknown()).max(WHATSAPP_BATCH_LIMIT).optional() });
const Media = z.object({ id: id.optional(), mime_type: z.string().max(256).optional(), sha256: z.string().max(128).optional(), filename: z.string().max(512).optional(), caption: z.string().max(4096).optional() });
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export type WhatsAppInboxItem = {
  id: string;
  source: 'WhatsApp';
  channel: 'whatsapp_cloud_api';
  providerMessageId: string;
  senderId: string;
  phoneNumberId: string;
  businessAccountId?: string;
  receivedAt: string;
  sentAt: string;
  type: string;
  status: 'captured' | 'unsupported';
  text?: string;
  unsupportedReason?: 'message_type_not_supported' | 'invalid_or_oversized_text';
  forwarding: { forwarded: boolean | null; frequentlyForwarded: boolean | null; originalSender: null; originalSentAt: null };
  context: { replyToMessageId?: string; replyToSenderId?: string };
  media?: z.infer<typeof Media>;
};

export function validWhatsAppSignature(raw: Buffer, signature: string | string[] | undefined, appSecret: string): boolean {
  if (!appSecret || typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function parseWhatsAppMessages(payload: unknown, config: Config, now = new Date().toISOString()): WhatsAppInboxItem[] {
  const envelope = Envelope.parse(payload); const items: WhatsAppInboxItem[] = []; let totalMessages = 0;
  for (const entry of envelope.entry) for (const change of entry.changes) {
    if (change.field !== 'messages') continue;
    const value = Value.parse(change.value);
    totalMessages += value.messages?.length || 0;
    if (totalMessages > WHATSAPP_BATCH_LIMIT) throw new AppError('whatsapp_batch_too_large', 'This webhook contains too many messages.', 413);
    if (value.metadata.phone_number_id !== config.WHATSAPP_PHONE_NUMBER_ID) continue;
    for (const input of value.messages || []) {
      const raw = record(input); if (raw.from !== config.WHATSAPP_OWNER_SENDER_ID) continue;
      const message = Message.parse(input); const sent = new Date(Number(message.timestamp) * 1000);
      if (!Number.isFinite(sent.getTime())) throw new AppError('invalid_webhook', 'The webhook message timestamp is invalid.', 400);
      const text = record(raw.text).body;
      const supported = message.type === 'text' && typeof text === 'string' && text.length > 0 && Buffer.byteLength(text, 'utf8') <= 16384;
      const media = ['image', 'audio', 'video', 'document', 'sticker'].includes(message.type) ? Media.safeParse(raw[message.type]) : null;
      items.push({
        id: hash(`${value.metadata.phone_number_id}\0${message.id}`), source: 'WhatsApp', channel: 'whatsapp_cloud_api', providerMessageId: message.id,
        senderId: message.from, phoneNumberId: value.metadata.phone_number_id, ...(entry.id ? { businessAccountId: entry.id } : {}), receivedAt: now, sentAt: sent.toISOString(), type: message.type,
        status: supported ? 'captured' : 'unsupported', ...(supported ? { text: text as string } : { unsupportedReason: message.type === 'text' ? 'invalid_or_oversized_text' as const : 'message_type_not_supported' as const }),
        forwarding: { forwarded: message.context?.forwarded ?? null, frequentlyForwarded: message.context?.frequently_forwarded ?? null, originalSender: null, originalSentAt: null },
        context: { ...(message.context?.id ? { replyToMessageId: message.context.id } : {}), ...(message.context?.from ? { replyToSenderId: message.context.from } : {}) },
        ...(media?.success ? { media: media.data } : {}),
      });
    }
  }
  return items;
}

export function captureWhatsAppMessages(store: Store, items: WhatsAppInboxItem[]): void {
  store.transaction(() => {
    const insert = store.db.prepare('INSERT OR IGNORE INTO records(bucket,id,payload) VALUES(?,?,?)');
    const exists = store.db.prepare('SELECT 1 FROM records WHERE bucket=? AND id=?');
    let count = (store.db.prepare('SELECT COUNT(*) n FROM records WHERE bucket=?').get(bucket) as { n: number }).n;
    const stats = store.get<WhatsAppStats>('whatsapp_spike_stats') || emptyStats(); let changed = false;
    for (const item of items) {
      if (exists.get(bucket, item.id)) continue;
      if (count >= WHATSAPP_INBOX_LIMIT) throw new AppError('whatsapp_inbox_full', 'The WhatsApp spike inbox needs attention before more messages can be accepted.', 503);
      insert.run(bucket, item.id, store.vault.seal(item, `${bucket}:${item.id}`)); count++; changed = true;
      if (item.status === 'captured') stats.capturedMessages++; else stats.unsupportedMessages++;
      if (item.forwarding.forwarded || item.forwarding.frequentlyForwarded) stats.forwardedMessages++;
      if (item.forwarding.frequentlyForwarded) stats.frequentlyForwardedMessages++;
      stats.lastReceivedAt = item.receivedAt;
    }
    if (changed) store.put('whatsapp_spike_stats', 'default', stats);
  });
}

export function readWhatsAppInbox(store: Store, limit = 50) {
  const total = (store.db.prepare('SELECT COUNT(*) n FROM records WHERE bucket=?').get(bucket) as { n: number }).n;
  const rows = store.db.prepare('SELECT id,payload FROM records WHERE bucket=? ORDER BY rowid DESC LIMIT ?').all(bucket, Math.min(50, Math.max(1, limit))) as { id: string; payload: string }[];
  return { total, items: rows.map(row => store.vault.open<WhatsAppInboxItem>(row.payload, `${bucket}:${row.id}`)) };
}

export function registerWhatsAppRoutes(app: FastifyInstance, config: Config, store: Store) {
  app.get('/v1/whatsapp/status', async () => ({ configured: whatsappConfigured(config), ...(store.get<WhatsAppStats>('whatsapp_spike_stats') || emptyStats()), inboxLimit: WHATSAPP_INBOX_LIMIT, processingEnabled: false, repliesEnabled: false }));
  app.get('/v1/whatsapp/inbox', async () => ({ configured: whatsappConfigured(config), ...readWhatsAppInbox(store) }));
  app.register(async webhook => {
    // Encapsulation keeps the normal /v1 JSON parser intact. Sign the exact bytes,
    // before parsing JSON, with a hard limit at the HTTP parser boundary.
    webhook.removeContentTypeParser('application/json');
    webhook.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: WHATSAPP_BODY_LIMIT }, (_request, body, done) => done(null, body));
    webhook.addHook('onRequest', async () => { if (!whatsappConfigured(config)) throw new AppError('not_found', 'This endpoint is not enabled.', 404); });
    webhook.get('/webhooks/whatsapp', async (request, reply) => {
      const query = new URL(request.url, 'http://localhost').searchParams;
      const mode = query.getAll('hub.mode'); const tokens = query.getAll('hub.verify_token'); const challenges = query.getAll('hub.challenge');
      if (mode.length !== 1 || mode[0] !== 'subscribe' || tokens.length !== 1 || !safeEqual(tokens[0]!, config.WHATSAPP_VERIFY_TOKEN) || challenges.length !== 1 || !challenges[0] || challenges[0].length > 512) throw new AppError('verification_failed', 'Webhook verification failed.', 403);
      return reply.type('text/plain').send(challenges[0]);
    });
    webhook.post('/webhooks/whatsapp', { bodyLimit: WHATSAPP_BODY_LIMIT }, async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) throw new AppError('invalid_webhook', 'Send a JSON webhook body.', 400);
      if (!validWhatsAppSignature(request.body, request.headers['x-hub-signature-256'], config.WHATSAPP_APP_SECRET)) throw new AppError('invalid_signature', 'Webhook signature verification failed.', 401);
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.body)); } catch { throw new AppError('invalid_webhook', 'The webhook body must contain valid UTF-8 JSON.', 400); }
      const items = parseWhatsAppMessages(payload, config);
      captureWhatsAppMessages(store, items);
      return reply.status(200).send({ received: true });
    });
  });
}
