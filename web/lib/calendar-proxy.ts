import { timingSafeEqual } from 'node:crypto';
import { appOrigin, isOwner, type CalendarSettings, type OwnerSession } from './access';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (code: string, message: string, status: number) => json({ error: { code, message } }, status);
function backendFailureReason(error: unknown) {
  const value = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  const code = value?.cause?.code || value?.code;
  if (['TimeoutError', 'AbortError'].includes(value?.name || '') || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code || '')) return 'timeout';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code || '')) return 'dns';
  if (['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code || '')) return 'tls';
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(code || '')) return 'connection';
  return 'network';
}
const routeAllowed = (method: string, path: string) =>
  (method === 'GET' && ['state', 'gmail/callback', 'calendar/feed', 'notifications'].includes(path)) ||
  (method === 'POST' && (/^gmail\/(connect|sync|disconnect|retry-processing)$/.test(path) || ['events', 'calendar/feed/enable', 'calendar/feed/rotate', 'notifications'].includes(path) || /^proposals\/[A-Za-z0-9_-]+\/(confirm|dismiss)$/.test(path))) ||
  (method === 'DELETE' && ['calendar/feed', 'notifications'].includes(path)) ||
  (['PATCH', 'DELETE'].includes(method) && /^events\/[A-Za-z0-9_-]+$/.test(path));

export function createCalendarHandler(deps: { session: () => Promise<OwnerSession>; settings: () => CalendarSettings; fetch?: typeof fetch }) {
  return async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
    const path = (await context.params).path.join('/');
    if (!routeAllowed(request.method, path)) return fail('not_found', 'This action is not available.', 404);
    const settings = deps.settings();
    let session: OwnerSession;
    try { session = await deps.session(); } catch { return fail('sign_in_required', 'Sign in to open your personal calendar.', 401); }
    if (!session?.user) return fail('sign_in_required', 'Sign in to open your personal calendar.', 401);
    if (!settings.CALENDAR_OWNER_EMAIL || !settings.CALENDAR_OWNER_ID) return fail('setup_required', 'Your private calendar is being set up.', 503);
    if (!isOwner(session, settings)) return fail('owner_only', 'This calendar is private to its owner.', 403);
    let origin: string; let backend: URL;
    try {
      origin = appOrigin(settings.CALENDAR_APP_ORIGIN);
      backend = new URL(settings.CALENDAR_API_BASE_URL!);
      if (!settings.CALENDAR_SERVICE_TOKEN || backend.username || backend.password || backend.search || backend.hash || !['https:', 'http:'].includes(backend.protocol)) throw new Error('Invalid backend settings');
      if (backend.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(backend.hostname)) throw new Error('Backend requires HTTPS');
    } catch { return fail('setup_required', 'Your private calendar is being connected. Please try again shortly.', 503); }
    if (request.method !== 'GET' && (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site')) return fail('origin_required', 'Open this action from your calendar.', 403);
    const secure = origin.startsWith('https:');
    const cookieName = secure ? '__Host-calendar-gmail-state' : 'calendar-gmail-state';
    const stateCookie = (value: string, age: number) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
    const call = async (backendPath: string, method: string, body?: unknown) => {
      const attempts = method === 'GET' ? 2 : 1;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const response = await (deps.fetch || fetch)(`${backend.href.replace(/\/$/, '')}/v1/${backendPath}`, {
            method, headers: { Authorization: `Bearer ${settings.CALENDAR_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(method === 'GET' ? 10000 : 25000), redirect: 'manual',
          });
          if ([502, 503, 504].includes(response.status)) {
            console.warn('calendar_backend_request_failed', { operation: method === 'GET' ? 'read' : 'write', reason: 'upstream_unavailable', attempt });
            if (attempt < attempts) { await response.body?.cancel(); continue; }
          }
          return response;
        } catch (error) {
          // Fixed categories only: never log request bodies, URLs, identifiers,
          // credentials or raw provider/network error messages.
          console.warn('calendar_backend_request_failed', { operation: method === 'GET' ? 'read' : 'write', reason: backendFailureReason(error), attempt });
          if (attempt === attempts) throw error;
        }
      }
      throw new Error('Backend request did not complete');
    };
    const callbackRedirect = (result: string) => new Response(null, { status: 303, headers: { Location: `${origin}/calendar?gmail=${result}`, 'Set-Cookie': stateCookie('', 0), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    try {
      if (path === 'gmail/callback') {
        const url = new URL(request.url); const states = url.searchParams.getAll('state'); const state = states[0];
        const saved = request.headers.get('cookie')?.split(';').map(c => c.trim()).filter(c => c.startsWith(`${cookieName}=`));
        const cookie = saved?.[0]?.slice(cookieName.length + 1);
        if (states.length !== 1 || !state || !/^[A-Za-z0-9_-]{32,256}$/.test(state) || saved?.length !== 1 || !cookie || Buffer.byteLength(cookie) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))) return callbackRedirect('expired');
        if (url.searchParams.has('error')) return callbackRedirect('cancelled');
        const codes = url.searchParams.getAll('code'); const code = codes[0];
        if (codes.length !== 1 || !code || code.length > 4096) return callbackRedirect('failed');
        const result = await call('gmail/callback', 'POST', { ownerId: settings.CALENDAR_OWNER_ID, state, code });
        return callbackRedirect(result.ok ? 'connected' : 'failed');
      }
      let body: unknown;
      if (request.method !== 'GET') {
        if (Number(request.headers.get('content-length') || 0) > 32768) return fail('input_too_large', 'This entry is too long.', 413);
        const text = await request.text(); if (Buffer.byteLength(text) > 32768) return fail('input_too_large', 'This entry is too long.', 413);
        try { body = text ? JSON.parse(text) : {}; } catch { return fail('invalid_input', 'Check the details and try again.', 400); }
      }
      if (path === 'gmail/connect') body = { ownerId: settings.CALENDAR_OWNER_ID };
      const result = await call(path, request.method, body);
      const data = await result.json() as { url?: string; state?: string; error?: { code?: string; message?: string } };
      if (!result.ok) return fail(data.error?.code || 'service_error', data.error?.message || 'That action could not be completed. Please try again.', result.status >= 500 ? 503 : result.status);
      if (path === 'gmail/connect') {
        if (!data.url || !data.state || !/^[A-Za-z0-9_-]{32,256}$/.test(data.state) || new URL(data.url).origin !== 'https://accounts.google.com') return fail('connection_error', 'Google connection could not be started.', 502);
        const response = json({ url: data.url }); response.headers.set('Set-Cookie', stateCookie(data.state, 600)); return response;
      }
      return json(data, result.status);
    } catch {
      if (path === 'gmail/callback') return callbackRedirect('failed');
      return fail('service_unavailable', 'Your calendar is temporarily unavailable. Your saved plans are safe; please try again.', 503);
    }
  };
}
