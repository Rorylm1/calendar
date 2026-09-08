import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../lib/client-api.ts';
import { createRefreshQueue } from '../lib/refresh-queue.ts';

test('a hung connection settles within the client deadline and can be retried', async () => {
  let calls = 0; let signal: AbortSignal | undefined;
  const api = createApi(async (_url, options) => {
    signal = options?.signal as AbortSignal;
    if (++calls === 1) return new Promise<Response>(() => undefined);
    return Response.json({ ready: true });
  }, 15);
  await assert.rejects(api('state'), { code: 'request_timeout' });
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await api('state'), { ready: true });
});

test('response bodies share the deadline and uncertain writes are not replayed', async () => {
  let calls = 0;
  const api = createApi(async () => {
    calls++;
    return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } });
  }, 15);
  await assert.rejects(api('events', 'POST', { title: 'Invented plan' }), error => {
    assert.match((error as Error).message, /couldn’t confirm whether that change was saved/);
    return (error as { code: string }).code === 'request_timeout';
  });
  assert.equal(calls, 1);
});

test('an HTML gateway error becomes a useful error, while authorization codes survive', async () => {
  const unavailable = createApi(async () => new Response('<html>Gateway failure</html>', { status: 503 }));
  await assert.rejects(unavailable('state'), { code: 'service_unavailable', message: 'Your calendar could not be loaded. Please try again.' });
  const denied = createApi(async () => Response.json({ error: { code: 'sign_in_required', message: 'Sign in again.' } }, { status: 401 }));
  await assert.rejects(denied('state'), { code: 'sign_in_required', message: 'Sign in again.' });
});

test('focus and polling cannot supersede a slow successful calendar read', async () => {
  let finish!: () => void; let calls = 0; const published: number[] = [];
  const refresh = createRefreshQueue(async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); published.push(calls); });
  const first = refresh(); await Promise.resolve();
  assert.equal(refresh(), first); assert.equal(refresh(), first); assert.equal(calls, 1);
  finish(); await first;
  assert.deepEqual(published, [1]);
});

test('a mutation waits for any older read, then gets one fresh snapshot', async () => {
  const pending: (() => void)[] = []; const snapshots: string[] = []; let value = 'before';
  const refresh = createRefreshQueue(async () => { const snapshot = value; await new Promise<void>(resolve => pending.push(resolve)); snapshots.push(snapshot); });
  const old = refresh(); await Promise.resolve(); value = 'after';
  const afterWrite = refresh(true); const coalesced = refresh();
  pending.shift()!(); await old; await coalesced; await Promise.resolve();
  assert.deepEqual(snapshots, ['before']); assert.equal(pending.length, 1);
  pending.shift()!(); await afterWrite; assert.deepEqual(snapshots, ['before', 'after']);
});
