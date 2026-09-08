import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDeliverySettings, type FeedSettings } from '../lib/delivery-settings-loader.ts';
import type { NotificationSettings } from '../lib/push-client.ts';

const feed: FeedSettings = { configured: true, enabled: false, url: null, webcalUrl: null, blockedEvents: [] };
const notifications: NotificationSettings = { configured: true, publicKey: null, enabled: false, subscriptionCount: 0, subscriptionIds: [], delivery: { state: 'idle', lastSentAt: null, lastErrorCode: null, nextAttemptAt: null } };

test('subscription controls become available while notifications are pending and survive their failure', async () => {
  let failNotifications!: (error: Error) => void;
  const pendingNotifications = new Promise<NotificationSettings>((_, reject) => { failNotifications = reject; });
  let visibleFeed: FeedSettings | undefined;
  let notificationError: unknown;
  const run = loadDeliverySettings({
    current: () => true,
    feed: { ready: value => { visibleFeed = value; }, failed: () => assert.fail('Feed must remain available') },
    notifications: { ready: () => assert.fail('Notification request must fail'), failed: error => { notificationError = error; } },
  }, async <T>(path: string) => (path === 'calendar/feed' ? feed : await pendingNotifications) as T);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(visibleFeed, feed);
  assert.equal(notificationError, undefined);
  failNotifications(new Error('Notifications unavailable'));
  await run;
  assert.equal(visibleFeed, feed);
  assert.match(String(notificationError), /Notifications unavailable/);
});

test('a subscription failure does not discard successful notification settings', async () => {
  let visibleNotifications: NotificationSettings | undefined;
  let feedError: unknown;
  await loadDeliverySettings({
    current: () => true,
    feed: { ready: () => assert.fail('Feed request must fail'), failed: error => { feedError = error; } },
    notifications: { ready: value => { visibleNotifications = value; }, failed: () => assert.fail('Notifications must remain available') },
  }, async <T>(path: string) => { if (path === 'calendar/feed') throw new Error('Feed unavailable'); return notifications as T; });
  assert.equal(visibleNotifications, notifications);
  assert.match(String(feedError), /Feed unavailable/);
});

test('closing the panel prevents pending private settings or errors from being published', async () => {
  let current = true;
  let settle!: () => void;
  const pending = new Promise<void>(resolve => { settle = resolve; });
  const unwanted = () => assert.fail('Closed settings must not update');
  const run = loadDeliverySettings({ current: () => current, feed: { ready: unwanted, failed: unwanted }, notifications: { ready: unwanted, failed: unwanted } }, async <T>(path: string) => {
    await pending;
    if (path === 'notifications') throw new Error('Late notification failure');
    return feed as T;
  });
  current = false;
  settle();
  await run;
});
