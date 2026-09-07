import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import type OpenAI from 'openai';
import { GmailReadPacer, GoogleGateway, retryGmailRead } from '../src/gmail.ts';
import { ProviderError } from '../src/errors.ts';
import { ModelInterpreter } from '../src/interpreter.ts';
import { fixture, source } from './helpers.ts';

test('Google authorization asks only for read-only Gmail, offline access, and PKCE', async () => {
  const { config, store } = fixture(); const gateway = new GoogleGateway(config, store); const { url, state } = await gateway.connect('owner'); const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly'); assert.equal(parsed.searchParams.get('access_type'), 'offline'); assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256'); assert.equal(parsed.searchParams.get('redirect_uri'), config.GOOGLE_REDIRECT_URI); assert.equal(parsed.searchParams.get('state'), state); assert.ok(state.length >= 40); store.close();
});
test('OAuth callback rejects another mailbox without overwriting existing credentials', async () => {
  const { config, store } = fixture(); store.put('credentials', 'default', { refresh_token: 'existing-private-token' }); let revoked = 0;
  const client = Object.assign(new OAuth2Client(), { getToken: async () => ({ tokens: { refresh_token: 'wrong-account-token', access_token: 'wrong-access' } }), request: async () => ({ data: { emailAddress: 'stranger@example.test', historyId: '100' } }), revokeToken: async () => { revoked++; return {}; } }) as OAuth2Client;
  const gateway = new GoogleGateway(config, store, () => client); store.createOAuthState('synthetic-state', 'owner', 'synthetic-verifier');
  await assert.rejects(gateway.callback('owner', 'synthetic-code', 'synthetic-state'), /configured/); assert.equal(revoked, 1); assert.equal(store.get<{ refresh_token: string }>('credentials')!.refresh_token, 'existing-private-token'); assert.equal(store.get('connection'), undefined); store.close();
});
test('verified callback persists offline credentials and consumes state once', async () => {
  const { config, store } = fixture(); let receivedVerifier = '';
  const client = Object.assign(new OAuth2Client(), { getToken: async (value: { codeVerifier: string }) => { receivedVerifier = value.codeVerifier; return { tokens: { refresh_token: 'synthetic-refresh', access_token: 'synthetic-access' } }; }, request: async () => ({ data: { emailAddress: config.GMAIL_ALLOWED_EMAIL, historyId: '100' } }) }) as OAuth2Client;
  const gateway = new GoogleGateway(config, store, () => client); store.createOAuthState('synthetic-state', 'owner', 'synthetic-verifier');
  assert.deepEqual(await gateway.callback('owner', 'synthetic-code', 'synthetic-state'), { connected: true }); assert.equal(receivedVerifier, 'synthetic-verifier'); assert.ok(store.get('connection')); await assert.rejects(gateway.callback('owner', 'synthetic-code', 'synthetic-state')); store.close();
});
test('Responses uses schema validation and store:false, and caches completed triage', async () => {
  const { config, store } = fixture(); const calls: Record<string, unknown>[] = [];
  const client = { responses: { parse: async (request: Record<string, unknown>) => { calls.push(request); return { status: 'completed', output_parsed: { decision: 'relevant', reason: 'Confirmed reservation' }, usage: { input_tokens: 200, output_tokens: 80 } }; } } } as unknown as OpenAI;
  const model = new ModelInterpreter(config, store, client); await model.triage(source()); await model.triage(source());
  assert.equal(calls.length, 1); assert.equal(calls[0]!.store, false); assert.equal(calls[0]!.model, 'google/gemini-3.5-flash-lite'); assert.equal(calls[0]!.tools, undefined); assert.ok(JSON.stringify(calls[0]!.text).includes('json_schema')); assert.ok(store.spend() > 0); assert.ok(store.spend() < 0.001); assert.deepEqual(calls[0]!.provider, { require_parameters: true, data_collection: 'deny', max_price: { prompt: 0.3, completion: 2.5 } }); store.close();
});
test('unknown provider outcomes retain a conservative cost reservation', async () => {
  const { config, store } = fixture(); const client = { responses: { parse: async () => { throw new Error('Synthetic timeout, potentially billed'); } } } as unknown as OpenAI;
  const model = new ModelInterpreter(config, store, client); await assert.rejects(model.triage(source())); assert.ok(store.spend() > 0); assert.equal(store.get('triage', 'm1'), undefined); store.close();
});
test('disconnect invalidates an OAuth callback already exchanging its code', async () => {
  const { config, store } = fixture(); let release!: () => void; let started!: () => void; const exchanging = new Promise<void>(resolve => { started = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; }); let revoked = 0;
  const client = Object.assign(new OAuth2Client(), { getToken: async () => { started(); await wait; return { tokens: { refresh_token: 'late-refresh', access_token: 'late-access' } }; }, request: async () => ({ data: { emailAddress: config.GMAIL_ALLOWED_EMAIL, historyId: '100' } }), revokeToken: async () => { revoked++; return {}; } }) as OAuth2Client;
  const gateway = new GoogleGateway(config, store, () => client); store.createOAuthState('racing-state', 'owner', 'verifier');
  const callback = gateway.callback('owner', 'synthetic-code', 'racing-state'); const rejection = assert.rejects(callback, /cancelled/); await exchanging; await gateway.disconnect(); release(); await rejection;
  assert.equal(store.get('connection'), undefined); assert.equal(store.get('credentials'), undefined); assert.equal(revoked, 1); store.close();
});
test('OpenRouter credentials are sent only to the fixed OpenRouter endpoint', async () => {
  const { config, store } = fixture(); config.OPENROUTER_API_KEY = 'synthetic-openrouter-key'; const oldFetch = globalThis.fetch; let requestUrl = ''; let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url); assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-openrouter-key'); requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'synthetic-response', object: 'response', created_at: 0, status: 'completed', model: config.AI_TRIAGE_MODEL, output: [{ id: 'message', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [], text: JSON.stringify({ decision: 'relevant', reason: 'A synthetic booking' }) }] }], usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280, cost: 0.000123 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const model = new ModelInterpreter(config, store); await model.triage(source());
    assert.equal(requestUrl, 'https://openrouter.ai/api/v1/responses'); assert.equal(requestBody.store, false); assert.equal((requestBody.provider as { data_collection: string }).data_collection, 'deny'); assert.equal(store.spend(), 0.000123);
    assert.equal(store.all<{ costSource: string }>('model_usage')[0]!.costSource, 'provider');
  } finally { globalThis.fetch = oldFetch; store.close(); }
});
test('transient Gmail reads retry a bounded number of times; authorization failures do not retry', async () => {
  let calls = 0; const delays: number[] = [];
  const result = await retryGmailRead(async () => { if (++calls < 3) throw new ProviderError(503); return 'recovered'; }, async ms => { delays.push(ms); });
  assert.equal(result, 'recovered'); assert.equal(calls, 3); assert.deepEqual(delays, [500, 1500]);
  calls = 0; await assert.rejects(retryGmailRead(async () => { calls++; throw new ProviderError(429); }, async () => {})); assert.equal(calls, 3);
  calls = 0; await assert.rejects(retryGmailRead(async () => { calls++; throw new ProviderError(401, true); }, async () => {})); assert.equal(calls, 1);
});
test('Gmail reads reserve spaced slots, including concurrent callers, without delaying idle traffic', async () => {
  let now = 10000; const delays: number[] = [];
  const pacer = new GmailReadPacer(1000, () => now, async ms => { delays.push(ms); });
  await Promise.all([pacer.wait(), pacer.wait(), pacer.wait()]); assert.deepEqual(delays, [1000, 2000]);
  now = 20000; await pacer.wait(); assert.deepEqual(delays, [1000, 2000]);
});
test('Gmail quota failures wait a full quota window and stop after three attempts', async () => {
  let calls = 0; const delays: number[] = [];
  await assert.rejects(retryGmailRead(async () => { calls++; throw new ProviderError(403, false, true, 0, 'userRateLimitExceeded'); }, async ms => { delays.push(ms); }));
  assert.equal(calls, 3); assert.deepEqual(delays, [60000, 60000]);
  const hintedDelays: number[] = []; calls = 0;
  assert.equal(await retryGmailRead(async () => { if (++calls === 1) throw new ProviderError(503, false, true, 5000); return 'ok'; }, async ms => { hintedDelays.push(ms); }), 'ok');
  assert.deepEqual(hintedDelays, [5000]);
});
test('aborting Gmail quota and pacing waits prevents another read promptly', async () => {
  const controller = new AbortController(); let calls = 0;
  const waiting = retryGmailRead(async () => { calls++; throw new ProviderError(403, false, true, 0, 'userRateLimitExceeded'); }, undefined, controller.signal);
  const rejected = assert.rejects(waiting, { name: 'AbortError' }); await new Promise(resolve => setTimeout(resolve, 10)); controller.abort(); await rejected; assert.equal(calls, 1);
  const pacer = new GmailReadPacer(60000); await pacer.wait(); const pacedController = new AbortController();
  const paced = assert.rejects(pacer.wait(pacedController.signal), { name: 'AbortError' }); pacedController.abort(); await paced;
});
