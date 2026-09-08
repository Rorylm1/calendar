/* Notifications only: never cache private pages, API responses or credentials. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('My Calendar', {
    body: 'Your calendar has new updates.', tag: 'calendar-updates',
    icon: '/app-icon/192', badge: '/app-icon/192',
    data: { url: '/calendar' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('/calendar', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && url.pathname === '/calendar') {
        await client.navigate(target); await client.focus(); return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
