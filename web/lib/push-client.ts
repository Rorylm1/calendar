'use client';
import { api } from './client-api';

export type NotificationSettings = {
  configured: boolean; publicKey: string | null; enabled: boolean; subscriptionCount: number; subscriptionIds: string[];
  delivery: { state: string; lastSentAt: string | null; lastErrorCode: string | null; nextAttemptAt: string | null };
};
export function pushSupported() {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export async function prepareNotifications() {
  if (!pushSupported()) return null;
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Notifications are taking a little longer to start. Try again.')), 10000); })]); }
  finally { clearTimeout(timer); }
}
export async function deviceIsSubscribed(settings: NotificationSettings) {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
  const id = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return settings.subscriptionIds.includes(id);
}
export function subscribeDevice(registration: ServiceWorkerRegistration, publicKey: string) {
  // Request permission before any await to retain the explicit button gesture on iOS.
  const permission = Notification.requestPermission();
  return (async () => {
    if (await permission !== 'granted') throw new Error('Notifications are off. You can change this in your device’s notification settings.');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
      const key = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    try { return await api<NotificationSettings>('notifications', 'POST', { subscription: subscription.toJSON() }); }
    catch (error) { await subscription.unsubscribe().catch(() => false); throw error; }
  })();
}
export async function stopDeviceNotifications() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  const tasks: Promise<unknown>[] = [];
  if (subscription) tasks.push(api('notifications', 'DELETE', { endpoint: subscription.endpoint }), subscription.unsubscribe());
  if (registration) tasks.push(registration.getNotifications().then(notifications => notifications.forEach(notification => notification.close())));
  const results = await Promise.allSettled(tasks);
  if (results.some(result => result.status === 'rejected')) throw new Error('Could not fully update notification settings. Try again, or turn them off in your device settings.');
}
