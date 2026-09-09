import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from 'next-auth/jwt';
import { allowedGoogleProfile, appOrigin, type CalendarSettings, type OwnerSession } from '../lib/access.ts';
import { createCalendarHandler } from '../lib/calendar-proxy.ts';
import { fixedIdentitySignInUrl } from '../lib/auth-request.ts';

const settings: CalendarSettings = { CALENDAR_OWNER_EMAIL: 'owner@example.test', CALENDAR_OWNER_ID: 'legacy-owner-id', CALENDAR_API_BASE_URL: 'https://backend.example.test', CALENDAR_SERVICE_TOKEN: 'synthetic-server-only-token', CALENDAR_APP_ORIGIN: 'https://calendar.example.test' };
const owner: OwnerSession = { user: { id: 'legacy-owner-id', email: 'owner@example.test', ownerVerified: true } };
const state = 'x'.repeat(48);
function fixture(session: OwnerSession = owner, response: unknown = { events: [], proposals: [] }) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const handle = createCalendarHandler({ session: async () => session, settings: () => settings, fetch: async (url, options) => { calls.push({ url: String(url), options }); return Response.json(response); } });
  const request = (path = 'state', method = 'GET', headers: Record<string, string> = {}, body?: string) => handle(new Request(`https://calendar.example.test/api/calendar/${path}`, { method, headers, body }), { params: Promise.resolve({ path: path.split('?')[0]!.split('/') }) });
  return { request, calls };
}
test('only the configured verified Google account can sign in', () => {
  assert.equal(allowedGoogleProfile('google', { email: 'OWNER@example.test', email_verified: true }, settings.CALENDAR_OWNER_EMAIL), true);
  for (const profile of [{ email: 'owner@example.test', email_verified: false }, { email: 'someone@example.test', email_verified: true }, { email: 'owner@example.test', email_verified: 'true' }]) assert.equal(allowedGoogleProfile('google', profile, settings.CALENDAR_OWNER_EMAIL), false);
  assert.equal(allowedGoogleProfile('github', { email: 'owner@example.test', email_verified: true }, settings.CALENDAR_OWNER_EMAIL), false);
  assert.equal(allowedGoogleProfile('google', { email: 'owner@example.test', email_verified: true }, undefined), false);
});
test('Auth.js JWT sessions are encrypted and reject tampering', async () => {
  const options = { secret: 'synthetic-session-secret-at-least-32-characters', salt: 'authjs.session-token' };
  const token = await encode({ ...options, token: { email: 'owner@example.test', ownerVerified: true }, maxAge: 60 });
  assert.equal(token.split('.').length, 5); assert.equal(token.includes('owner@example.test'), false); assert.equal((await decode({ ...options, token }))?.ownerVerified, true);
  const parts = token.split('.'); parts[3] = `${parts[3]![0] === 'a' ? 'b' : 'a'}${parts[3]!.slice(1)}`;
  await assert.rejects(decode({ ...options, token: parts.join('.') }));
});
test('spoofed Sites identity and forwarded host headers never authorize access', async () => {
  const { request, calls } = fixture(null);
  const result = await request('state', 'GET', { 'oai-authenticated-user-id': 'legacy-owner-id', 'oai-authenticated-user-email': 'owner@example.test', 'x-forwarded-host': 'calendar.example.test', 'x-forwarded-proto': 'https' });
  assert.equal(result.status, 401); assert.equal(calls.length, 0);
});
test('owner email, fixed owner ID, and verified session marker are all required', async () => {
  for (const user of [{ id: 'other', email: 'owner@example.test', ownerVerified: true }, { id: 'legacy-owner-id', email: 'stranger@example.test', ownerVerified: true }, { id: 'legacy-owner-id', email: 'owner@example.test' }]) {
    const { request, calls } = fixture({ user }); assert.equal((await request()).status, 403); assert.equal(calls.length, 0);
  }
});
test('mutations require the exact configured origin, independent of host headers', async () => {
  const origins: Record<string, string>[] = [{}, { origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'https://calendar.example.test', 'sec-fetch-site': 'cross-site' }];
  for (const headers of origins) {
    const { request, calls } = fixture(); assert.equal((await request('gmail/sync', 'POST', { ...headers, 'x-forwarded-host': 'calendar.example.test' })).status, 403); assert.equal(calls.length, 0);
  }
});
test('authenticated reads send only the server credential to the configured backend', async () => {
  const { request, calls } = fixture(); const result = await request('state', 'GET', { authorization: 'Bearer user-controlled', cookie: 'untrusted-cookie=value', 'x-forwarded-host': 'evil.example' });
  assert.equal(result.status, 200); assert.equal(calls[0]!.url, 'https://backend.example.test/v1/state'); assert.equal(calls[0]!.options?.redirect, 'manual');
  const headers = new Headers(calls[0]!.options?.headers); assert.equal(headers.get('authorization'), 'Bearer synthetic-server-only-token'); assert.equal(headers.get('cookie'), null); assert.equal(result.headers.get('cache-control'), 'no-store');
});
test('Gmail connect preserves the legacy owner and creates a secure host-only state cookie', async () => {
  const { request, calls } = fixture(owner, { url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`, state });
  const result = await request('gmail/connect', 'POST', { origin: settings.CALENDAR_APP_ORIGIN! }, JSON.stringify({ ownerId: 'attacker-controlled' }));
  assert.equal(result.status, 200); assert.deepEqual(JSON.parse(String(calls[0]!.options?.body)), { ownerId: 'legacy-owner-id' });
  const cookie = result.headers.get('set-cookie')!; assert.match(cookie, /^__Host-calendar-gmail-state=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\//); assert.match(cookie, /Max-Age=600/);
  assert.equal((await result.json()).state, undefined);
});
test('Gmail callbacks reject missing, mismatched, duplicated, and ambiguous state', async () => {
  for (const [query, cookie] of [[`state=${state}&code=synthetic`, ''], [`state=${state}&code=synthetic`, `__Host-calendar-gmail-state=${'y'.repeat(48)}`], [`state=${state}&code=synthetic`, `__Host-calendar-gmail-state=${state}; __Host-calendar-gmail-state=${state}`], [`state=${state}&state=${state}&code=synthetic`, `__Host-calendar-gmail-state=${state}`]]) {
    const { request, calls } = fixture(); const result = await request(`gmail/callback?${query}`, 'GET', { cookie: cookie! });
    assert.equal(result.status, 303); assert.equal(result.headers.get('location'), 'https://calendar.example.test/calendar?gmail=expired'); assert.equal(calls.length, 0); assert.match(result.headers.get('set-cookie')!, /Max-Age=0/);
  }
});
test('valid Gmail callback is session-protected, bound to the legacy owner, and clears state', async () => {
  const { request, calls } = fixture(owner, { connected: true }); const result = await request(`gmail/callback?state=${state}&code=synthetic-code`, 'GET', { cookie: `__Host-calendar-gmail-state=${state}` });
  assert.equal(result.headers.get('location'), 'https://calendar.example.test/calendar?gmail=connected'); assert.match(result.headers.get('set-cookie')!, /Max-Age=0/); assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(JSON.parse(String(calls[0]!.options?.body)), { ownerId: 'legacy-owner-id', state, code: 'synthetic-code' });
});
test('unapproved proxy routes and oversized writes never reach the backend', async () => {
  const { request, calls } = fixture(); assert.equal((await request('credentials')).status, 404); assert.equal((await request('events/../credentials', 'DELETE', { origin: settings.CALENDAR_APP_ORIGIN! })).status, 404);
  assert.equal((await request('events', 'POST', { origin: settings.CALENDAR_APP_ORIGIN! }, 'x'.repeat(32769))).status, 413); assert.equal(calls.length, 0);
});
test('production origins must be HTTPS without credentials, paths, or URL suffixes', () => {
  assert.equal(appOrigin('http://localhost:3000'), 'http://localhost:3000');
  for (const value of ['http://calendar.example.test', 'https://user:pass@calendar.example.test', 'https://calendar.example.test/path', 'https://calendar.example.test?other=1']) assert.throws(() => appOrigin(value));
});
test('identity sign-in cannot override scopes or callbacks through URL parameters', () => {
  assert.equal(fixedIdentitySignInUrl('https://calendar.example.test/api/auth/signin/google?scope=gmail.modify&redirect_uri=https://evil.example&access_type=offline'), 'https://calendar.example.test/api/auth/signin/google');
  const callback = `https://calendar.example.test/api/auth/callback/google?code=synthetic&state=${state}`;
  assert.equal(fixedIdentitySignInUrl(callback), callback);
});
test('private feed settings and push controls retain owner and origin checks', async () => {
  for (const [path, method] of [['calendar/feed', 'GET'], ['calendar/feed/enable', 'POST'], ['calendar/feed/rotate', 'POST'], ['calendar/feed', 'DELETE'], ['notifications', 'GET'], ['notifications', 'POST'], ['notifications', 'DELETE']]) {
    const anonymous = fixture(null); assert.equal((await anonymous.request(path, method)).status, 401); assert.equal(anonymous.calls.length, 0);
    if (method !== 'GET') { const crossSite = fixture(); assert.equal((await crossSite.request(path, method, { origin: 'https://evil.example' }, '{}')).status, 403); assert.equal(crossSite.calls.length, 0); }
    const allowed = fixture(); const response = await allowed.request(path, method, { origin: settings.CALENDAR_APP_ORIGIN! }, method === 'GET' ? undefined : '{}');
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(allowed.calls[0]!.url, `https://backend.example.test/v1/${path}`);
  }
  const { request, calls } = fixture();
  assert.equal((await request('calendar/feed/synthetic-private-link.ics')).status, 404);
  assert.equal((await request('notifications/send', 'POST', { origin: settings.CALENDAR_APP_ORIGIN! }, '{}')).status, 404);
  assert.equal(calls.length, 0);
});
test('transient reads retry once, writes never replay, and diagnostics contain no secrets', async context => {
  const logs: unknown[][] = []; context.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
  for (const method of ['GET', 'POST']) {
    let calls = 0;
    const handle = createCalendarHandler({ session: async () => owner, settings: () => settings, fetch: async () => {
      if (++calls === 1) throw Object.assign(new Error('Private URL and bearer must not enter logs'), { cause: { code: 'ECONNRESET' } });
      return Response.json({ configured: true });
    } });
    const response = await handle(new Request('https://calendar.example.test/api/calendar/notifications', { method, headers: { origin: settings.CALENDAR_APP_ORIGIN! }, body: method === 'POST' ? '{}' : undefined }), { params: Promise.resolve({ path: ['notifications'] }) });
    assert.equal(calls, method === 'GET' ? 2 : 1); assert.equal(response.status, method === 'GET' ? 200 : 503);
  }
  assert.equal(logs.length, 2); assert.equal(JSON.stringify(logs).includes('Private URL'), false); assert.equal(JSON.stringify(logs).includes('synthetic-server-only-token'), false);
  assert.equal(logs[0]![0], 'calendar_backend_request_failed');
  assert.deepEqual({ ...(logs[0]![1] as object), elapsedMs: 0 }, { operation: 'read', reason: 'connection', attempt: 1, phase: 'headers', elapsedMs: 0 });
});

test('a failed read body retries and has distinct diagnostics from connection deadlines', async context => {
  const logs: unknown[][] = []; context.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
  let calls = 0;
  const handle = createCalendarHandler({ session: async () => owner, settings: () => settings, fetch: async () => {
    if (++calls === 1) return new Response(new ReadableStream({ start(controller) { controller.error(new DOMException('Do not log body details', 'TimeoutError')); } }));
    return Response.json({ events: [], proposals: [] });
  } });
  const response = await handle(new Request('https://calendar.example.test/api/calendar/state'), { params: Promise.resolve({ path: ['state'] }) });
  assert.equal(response.status, 200); assert.equal(calls, 2);
  assert.equal((logs[0]![1] as { reason: string }).reason, 'request_timeout');
  assert.equal((logs[0]![1] as { phase: string }).phase, 'body');
  assert.equal(JSON.stringify(logs).includes('Do not log'), false);
});
test('gateway failures can retry a read but never replay a calendar write', async context => {
  context.mock.method(console, 'warn', () => undefined);
  for (const method of ['GET', 'POST']) {
    let calls = 0;
    const handle = createCalendarHandler({ session: async () => owner, settings: () => settings, fetch: async () => ++calls === 1 ? new Response('Gateway unavailable', { status: 502 }) : Response.json({ configured: true }) });
    const response = await handle(new Request('https://calendar.example.test/api/calendar/notifications', { method, headers: { origin: settings.CALENDAR_APP_ORIGIN! }, body: method === 'POST' ? '{}' : undefined }), { params: Promise.resolve({ path: ['notifications'] }) });
    assert.equal(calls, method === 'GET' ? 2 : 1); assert.equal(response.status, method === 'GET' ? 200 : 503);
  }
});

test('adding a Gmail inbox forwards its address while preserving the fixed calendar owner', async () => {
 const {request,calls}=fixture(owner,{url:`https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,state});
 const response=await request('gmail/connect','POST',{origin:settings.CALENDAR_APP_ORIGIN!},JSON.stringify({email:'second@gmail.com',ownerId:'forged'}));
 assert.equal(response.status,200);assert.deepEqual(JSON.parse(String(calls[0]!.options?.body)),{ownerId:'legacy-owner-id',email:'second@gmail.com'});
});
test('invalid additional inbox addresses never reach the backend', async () => {
 const {request,calls}=fixture(); const response=await request('gmail/connect','POST',{origin:settings.CALENDAR_APP_ORIGIN!},JSON.stringify({email:{ownerId:'forged'}}));
 assert.equal(response.status,400);assert.equal(calls.length,0);
});
