import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { type Config, googleConfigured } from './config.ts';
import { EventFields, EventPatch, type GmailConnection } from './domain.ts';
import { Store } from './store.ts';
import { GoogleGateway } from './gmail.ts';
import { ModelInterpreter } from './interpreter.ts';
import { CalendarWorker } from './worker.ts';
import { AppError } from './errors.ts';
import { safeEqual } from './crypto.ts';

const Owner = z.string().min(1).max(240);
const Revision = z.number().int().positive();
export function buildApp(config: Config, overrides: { store?: Store; google?: GoogleGateway; worker?: CalendarWorker; schedule?: boolean } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024, requestTimeout: 30_000, trustProxy: false });
  const store = overrides.store || new Store(config.CALENDAR_DB_PATH, config.CALENDAR_ENCRYPTION_KEY);
  const google = overrides.google || new GoogleGateway(config, store);
  const worker = overrides.worker || new CalendarWorker(config, store, signal => google.connectedProvider(signal), new ModelInterpreter(config, store));
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); reply.header('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && request.url === '/health') return;
    const token = request.headers.authorization;
    if (!token?.startsWith('Bearer ') || !safeEqual(token.slice(7), config.CALENDAR_SERVICE_TOKEN)) throw new AppError('unauthorized', 'Calendar access is required.', 401);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    if (error instanceof ZodError) return reply.status(400).send({ error: { code: 'invalid_input', message: `Check these fields: ${[...new Set(error.issues.map(issue => issue.path.join('.') || 'event'))].join(', ')}.` } });
    if ((error as { statusCode?: number }).statusCode === 400) return reply.status(400).send({ error: { code: 'invalid_input', message: 'The request must contain valid JSON.' } });
    return reply.status(500).send({ error: { code: 'service_error', message: 'The calendar could not complete that action. Please try again.' } });
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/v1/state', async () => {
    const connection = store.get<GmailConnection>('connection');
    const counts = store.counts();
    return { events: store.events(), proposals: store.proposals().filter(p => p.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), connection: {
      status: !googleConfigured(config) ? 'not_configured' : worker.syncing ? 'syncing' : connection?.status || 'disconnected',
      email: connection?.email || null, lastSyncAt: connection?.lastSyncAt || null, nextSyncAt: connection?.nextSyncAt || null,
      ...counts, processingStatus: counts.pendingMessages && !config.OPENROUTER_API_KEY && worker.processingStatus === 'idle' ? 'paused_missing_key' : worker.processingStatus,
      error: connection?.error || worker.processingError || null, warning: connection?.warning || null,
      model: config.AI_EXTRACTION_MODEL, triageModel: config.AI_TRIAGE_MODEL,
      monthlySpendUsd: Math.round(store.spend() * 1e6) / 1e6, monthlyBudgetUsd: config.AI_MONTHLY_BUDGET_USD, configured: googleConfigured(config),
    } };
  });
  app.post('/v1/gmail/connect', async request => { const body = z.object({ ownerId: Owner }).strict().parse(request.body); return google.connect(body.ownerId); });
  app.post('/v1/gmail/callback', async request => { const body = z.object({ ownerId: Owner, code: z.string().min(1).max(4096), state: z.string().min(20).max(500) }).strict().parse(request.body); const result = await google.callback(body.ownerId, body.code, body.state); worker.kick(); return result; });
  app.post('/v1/gmail/sync', async (_request, reply) => { const connection = store.get<GmailConnection>('connection'); if (!connection) throw new AppError('not_connected', 'Connect Gmail before checking for bookings.', 409); if (connection.status !== 'connected') throw new AppError('reconnect_required', 'Reconnect Gmail before checking for bookings.', 409); worker.kick(); return reply.status(202).send({ accepted: true }); });
  app.post('/v1/gmail/disconnect', async () => { await worker.stop(); const result = await google.disconnect(); if (overrides.schedule !== false) worker.start(); return result; });
  app.get('/v1/gmail/triage', async () => ({ entries: store.audit() }));
  app.post('/v1/gmail/retry-processing', async (_request, reply) => { store.retryFailures(); worker.kickProcessing(); return reply.status(202).send({ accepted: true }); });
  app.post('/v1/proposals/:id/confirm', async request => { const { id } = z.object({ id: z.string().min(1) }).parse(request.params); const body = z.object({ event: EventPatch.optional(), expectedRevision: Revision.optional() }).strict().parse(request.body || {}); return store.confirm(id, body.event, body.expectedRevision); });
  app.post('/v1/proposals/:id/dismiss', async request => { const { id } = z.object({ id: z.string().min(1) }).parse(request.params); return { proposal: store.dismiss(id) }; });
  app.post('/v1/events', async (request, reply) => reply.status(201).send({ event: store.createEvent(EventFields.parse(request.body)) }));
  app.patch('/v1/events/:id', async request => { const { id } = z.object({ id: z.string().min(1) }).parse(request.params); const body = z.object({ event: EventPatch, expectedRevision: Revision }).strict().parse(request.body); return { event: store.patchEvent(id, body.event, body.expectedRevision) }; });
  app.delete('/v1/events/:id', async request => { const { id } = z.object({ id: z.string().min(1) }).parse(request.params); const body = z.object({ expectedRevision: Revision }).strict().parse(request.body); store.deleteEvent(id, body.expectedRevision); return { deleted: true }; });
  app.addHook('onReady', async () => { if (overrides.schedule !== false) worker.start(); });
  app.addHook('onClose', async () => { await worker.stop(); if (!overrides.store) store.close(); });
  return { app, store, google, worker };
}
