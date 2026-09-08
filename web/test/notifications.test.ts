import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { subscribeDevice, stopDeviceNotifications } from '../lib/push-client.ts';

test('the service worker displays no source payload and opens only its own calendar', async () => {
  const handlers: Record<string, (event: any) => void> = {}; const shown: any[] = []; const opened: string[] = []; let awaited: Promise<void>;
  const self = { addEventListener: (type: string, callback: (event: any) => void) => { handlers[type] = callback; }, location: { origin: 'https://calendar.example.test' }, registration: { showNotification: async (...args: any[]) => { shown.push(args); } }, clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } } };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL });
  const payload = { data: { json: () => ({ title: 'Private booking', body: 'Sensitive evidence', url: 'https://evil.example' }) }, waitUntil: (value: Promise<void>) => { awaited = value; } };
  handlers.push!(payload); await awaited!;
  assert.equal(shown[0][0], 'My Calendar'); assert.equal(JSON.stringify(shown).includes('Sensitive'), false); assert.equal(shown[0][1].tag, 'calendar-updates');
  handlers.notificationclick!({ notification: { data: { url: 'https://evil.example' }, close() {} }, waitUntil: payload.waitUntil }); await awaited!;
  assert.deepEqual(opened, ['https://calendar.example.test/calendar']); assert.equal(handlers.fetch, undefined);
});
test('permission is requested immediately and denial does not create a subscription', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Notification'); let requested = false; let subscribed = false;
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { requestPermission: () => { requested = true; return Promise.resolve('denied'); } } });
  try {
    const action = subscribeDevice({ pushManager: { getSubscription: async () => { subscribed = true; } } } as any, 'synthetic-public-key');
    assert.equal(requested, true); await assert.rejects(action, /Notifications are off/); assert.equal(subscribed, false);
  } finally { if (previous) Object.defineProperty(globalThis, 'Notification', previous); else Reflect.deleteProperty(globalThis, 'Notification'); }
});
test('a failed save unsubscribes the browser instead of claiming notifications are enabled', async () => {
  const notification = Object.getOwnPropertyDescriptor(globalThis, 'Notification'); const originalFetch = globalThis.fetch; let unsubscribed = false;
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { requestPermission: async () => 'granted' } });
  globalThis.fetch = async () => Response.json({ error: { message: 'Synthetic service failure' } }, { status: 503 });
  try {
    const subscription = { toJSON: () => ({ endpoint: 'https://push.example.test/synthetic' }), unsubscribe: async () => { unsubscribed = true; return true; } };
    await assert.rejects(subscribeDevice({ pushManager: { getSubscription: async () => subscription } } as any, 'unused'), /Synthetic service failure/); assert.equal(unsubscribed, true);
  } finally { globalThis.fetch = originalFetch; if (notification) Object.defineProperty(globalThis, 'Notification', notification); else Reflect.deleteProperty(globalThis, 'Notification'); }
});
test('sign-out still unsubscribes locally when backend revocation fails', async () => {
  const keys = ['window', 'navigator', 'Notification'] as const; const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)); const originalFetch = globalThis.fetch; let unsubscribed = false; let closed = false;
  const subscription = { endpoint: 'https://push.example.test/synthetic', unsubscribe: async () => { unsubscribed = true; return true; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true, PushManager: function() {}, Notification: {} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription }, getNotifications: async () => [{ close: () => { closed = true; } }] }) } } });
  globalThis.fetch = async () => { throw new Error('Offline'); };
  try { await assert.rejects(stopDeviceNotifications(), /Could not fully update/); assert.equal(unsubscribed, true); assert.equal(closed, true); }
  finally { globalThis.fetch = originalFetch; keys.forEach((key, index) => { if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!); else Reflect.deleteProperty(globalThis, key); }); }
});
