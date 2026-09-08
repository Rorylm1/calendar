'use client';
import { useEffect, useState } from 'react';
import { Bell, CalendarDays, Check, Copy, Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/client-api';
import { loadDeliverySettings, type FeedSettings as Feed } from '@/lib/delivery-settings-loader';
import { deviceIsSubscribed, prepareNotifications, pushSupported, stopDeviceNotifications, subscribeDevice, type NotificationSettings } from '@/lib/push-client';
import type { CalendarEvent } from './types';

export default function DeliverySettings({ events, onEdit }: { events: CalendarEvent[]; onEdit: (event: CalendarEvent) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [device, setDevice] = useState<'loading' | 'home-screen' | 'supported' | 'unsupported'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');
  const [notificationsError, setNotificationsError] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | 'all-devices' | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoadingSettings(true); setFeed(null); setNotifications(null); setRegistration(null); setFeedError(''); setNotificationsError('');
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setDevice(ios && !installed ? 'home-screen' : pushSupported() ? 'supported' : 'unsupported');
    void loadDeliverySettings({
      current: () => current,
      feed: { ready: setFeed, failed: caught => setFeedError(caught instanceof Error ? caught.message : 'Subscription settings could not be loaded.') },
      notifications: {
        ready: nextNotifications => {
          setNotifications(nextNotifications);
          if (pushSupported() && (!ios || installed)) {
            void (async () => {
              try {
                const ready = await prepareNotifications();
                const active = await deviceIsSubscribed(nextNotifications);
                if (current) { setRegistration(ready); setSubscribed(active); }
              } catch (caught) {
                if (current) setNotificationsError(caught instanceof Error ? caught.message : 'Notifications could not be prepared.');
              }
            })();
          }
        },
        failed: caught => setNotificationsError(caught instanceof Error ? caught.message : 'Notification settings could not be loaded.'),
      },
    }).finally(() => { if (current) setLoadingSettings(false); });
    return () => { current = false; };
  }, [retry]);
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setConfirm(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="delivery-settings">
    <section className="delivery-section" aria-labelledby="calendar-delivery-title">
      <div className="connection-heading"><span className="connection-icon"><CalendarDays size={24} strokeWidth={1.4} /></span><div><h3 id="calendar-delivery-title">On your iPhone Calendar</h3><p>Plans and invitations, together.</p></div><span className="delivery-status">{feed ? feed.enabled ? 'Link active' : 'Off' : feedError ? 'Unavailable' : 'Loading'}</span></div>
      <p className="connection-explainer">One subscription includes your plans and invitations. Invitations start with “INVITATION: ” and have no reminders. Confirmed plans with a time get a 15-minute reminder by default; change it when editing a plan. Times without a time zone use London.</p>
      {!feed ? <p className="connection-small">{feedError ? 'Your subscription settings could not be loaded.' : 'Loading your subscription settings…'}</p> : !feed.configured ? <p className="connection-small">Your Calendar subscription is being set up.</p> : !feed.enabled ? <Button className="primary-action" disabled={busy} onClick={() => void act(async () => { setFeed(await api<Feed>('calendar/feed/enable', 'POST')); setNotice('Your private link is ready. Add it to Apple Calendar below.'); })}>Create private link</Button> : <>
        <div className="delivery-actions"><a className="delivery-link" href={feed.webcalUrl || undefined} referrerPolicy="no-referrer">Add to Apple Calendar <CalendarDays size={15} /></a><Button className="quiet-action" variant="ghost" disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(feed.url!); setNotice('Private link copied. Keep it to yourself.'); })}><Copy size={14} /> Copy link</Button></div>
        <p className="connection-small">Already subscribed? Keep your existing calendar. Invitations appear through the same link.</p>
        <details className="delivery-help"><summary>Subscription instructions</summary><ol><li>Tap Add to Apple Calendar, then subscribe once.</li><li>If the link does not open, copy it. In Apple Calendar, open Calendars, Add Calendar, then Add Subscription Calendar and paste it.</li><li>Keep Event Alerts on if you want reminders for confirmed plans.</li></ol><p>Marking an invitation as “I’m going” removes its prefix when Apple Calendar next refreshes. Calendar chooses when to refresh, so updates may take time. Check important travel details against your booking.</p><label className="field-label">Private subscription address<input className="private-feed-address" readOnly value={feed.url || ''} onFocus={event => event.target.select()} /></label></details>
        <div className="delivery-actions delivery-secondary"><button disabled={busy} onClick={() => setConfirm('rotate')}>Replace link</button><button disabled={busy} onClick={() => setConfirm('revoke')}>Turn off feed</button></div>
      </>}
      <p className="connection-small">Anyone with your link can read the exported plan details. Source messages and booking-reference fields are excluded. Replacing the link stops the old one from updating; it cannot erase copies already downloaded.</p>
      {feedError && <p className="delivery-attention" role="alert">{feedError}</p>}
      {Boolean(feed?.blockedEvents?.length) && <div className="delivery-attention"><p>A few plans need a time zone or date correction before they can appear in Apple Calendar.</p>{feed!.blockedEvents.map(blocked => { const event = events.find(item => item.id === blocked.id); return event ? <button key={event.id} onClick={() => onEdit(event)}>Edit {event.title}</button> : null; })}</div>}
    </section>
    <section className="delivery-section" aria-labelledby="calendar-alert-title">
      <div className="connection-heading"><span className="connection-icon"><Bell size={23} strokeWidth={1.4} /></span><div><h3 id="calendar-alert-title">A gentle heads-up</h3><p>New bookings, invitations and details needing attention.</p></div><span className="delivery-status">{notificationsError ? 'Unavailable' : !notifications || device === 'loading' || (device === 'supported' && !registration) ? 'Loading' : subscribed ? 'On this device' : 'Off here'}</span></div>
      <p className="connection-explainer">One grouped notification after your calendar has new updates. No booking details on your lock screen. Quiet from 10pm to 8am, London time.</p>
      {device === 'home-screen' ? <div className="delivery-install"><Smartphone size={19} /><div><strong>First, add Calendar to your Home Screen</strong><p>In Safari, open Share → Add to Home Screen. Keep Open as Web App on if shown. Open Calendar from its new icon, sign in, then return here to enable alerts.</p></div></div> : device === 'unsupported' ? <p className="connection-small">This browser cannot receive these alerts. On iPhone, use the Home Screen app on iOS 16.4 or later.</p> : !notifications?.configured ? <p className="connection-small">{notifications ? 'Calendar alerts are being set up.' : notificationsError ? 'Your notification settings could not be loaded.' : 'Loading notification settings…'}</p> : <Button className={subscribed ? 'quiet-action' : 'primary-action'} disabled={busy || !registration} onClick={() => void act(async () => {
        if (subscribed) { await stopDeviceNotifications(); setSubscribed(false); setNotifications(await api<NotificationSettings>('notifications')); setNotice('Calendar alerts are off on this device.'); }
        else if (registration && notifications.publicKey) { const next = await subscribeDevice(registration, notifications.publicKey); setNotifications(next); setSubscribed(await deviceIsSubscribed(next)); setNotice('Calendar alerts are on for new updates.'); }
      })}>{busy ? <Loader2 size={15} className="spinning" /> : subscribed ? <Check size={15} /> : <Bell size={15} />}{subscribed ? 'Turn off on this device' : 'Enable calendar alerts'}</Button>}
      {notificationsError && <p className="delivery-attention" role="alert">{notificationsError}</p>}
      {notifications?.subscriptionCount ? <p className="connection-small">Alerts enabled on {notifications.subscriptionCount} device{notifications.subscriptionCount === 1 ? '' : 's'}. <button className="delivery-text-button" disabled={busy} onClick={() => setConfirm('all-devices')}>Turn off everywhere</button></p> : null}
      {notifications?.delivery.lastErrorCode && <p className="delivery-attention">Some alerts could not be delivered. Your calendar still has the latest saved updates. Turn alerts off and back on here if the problem continues.</p>}
      <p className="connection-small">Calendar alerts start with new updates after you opt in. Event reminders come from your Apple Calendar subscription. Signing out turns off alerts on this device.</p>
    </section>
    {confirm && <div className="delivery-confirm"><p>{confirm === 'rotate' ? 'Replace your private link? Existing subscriptions will stop updating. Add the new link to each calendar afterwards.' : confirm === 'revoke' ? 'Turn off the feed? Existing subscriptions will stop updating. Remove the subscribed calendar on your device to clear downloaded plans.' : 'Turn off calendar alerts on every device? You can enable them again individually.'}</p><div className="delivery-actions"><Button className="primary-action" disabled={busy} onClick={() => void act(async () => {
      if (confirm === 'all-devices') { await api('notifications', 'DELETE'); await stopDeviceNotifications(); setNotifications(await api<NotificationSettings>('notifications')); setSubscribed(false); setNotice('Calendar alerts are off everywhere.'); }
      else { const next = await api<Feed>(confirm === 'rotate' ? 'calendar/feed/rotate' : 'calendar/feed', confirm === 'rotate' ? 'POST' : 'DELETE'); setFeed(next); setNotice(confirm === 'rotate' ? 'Link replaced. Subscribe using the new link.' : 'Calendar feed turned off.'); }
    })}>{confirm === 'rotate' ? 'Replace link' : 'Turn off'}</Button><Button variant="ghost" className="quiet-action" disabled={busy} onClick={() => setConfirm(null)}>Keep as it is</Button></div></div>}
    {notice && <p className="delivery-feedback" role="status">{notice}</p>}
    {error && <div className="personal-inline-error" role="alert"><p>{error}</p></div>}
    {(error || feedError || notificationsError) && <button className="error-recovery" disabled={busy || loadingSettings} onClick={() => { setError(''); setRetry(value => value + 1); }}>{loadingSettings ? 'Loading settings…' : 'Reload settings'}</button>}
  </div>;
}
