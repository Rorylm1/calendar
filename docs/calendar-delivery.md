# Calendar delivery

Implemented on 7 September 2026. The app's Connections panel now offers a private Apple Calendar subscription and optional grouped review alerts. Both remain off until the owner enables them. Physical iPhone acceptance is still pending.

## Where to enable it

On your iPhone, open [the live calendar](https://rory-calendar.vercel.app/calendar) and sign in. Tap **Connections** in the top bar, then scroll to **On your iPhone Calendar**. Choose **Create private link**, then **Add to Apple Calendar** and subscribe. In Apple's Calendar app, open **Calendars**, tap the information button beside this subscription, and turn on **Event Alerts** if you want reminders. Older versions of our interface labelled the Connections button **Gmail**.

The subscription and notification sections load independently. A notification-settings failure does not hide a successfully loaded subscription. Failed settings show an error and a **Reload settings** control rather than continuing to claim they are loading.

## Private subscription

Create a private link, then choose Add to Apple Calendar. The link contains a random 256-bit secret and gives its holder read access to confirmed plan titles, dates, locations and notes. The separate booking-reference field, source messages and proposal evidence are excluded; notes may still contain information the owner has included. Treat the URL as a credential. It is encrypted at rest and never put into ordinary application logs or public documentation.

Replacing a link invalidates its previous URL immediately; each subscribed calendar must then use the replacement. Turning the feed off rejects future requests. Neither action erases copies already downloaded by a calendar client. Remove the subscribed calendar on that device to clear those copies.

Event identifiers stay stable. Approved edits advance the sequence and modification timestamp; deletion or confirmed cancellation removes the event from the next subscription snapshot. Pending suggestions never enter the feed. Dates and times follow [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545): timed events use UTC, converting explicit time zones or London when a zone is absent. An ambiguous/nonexistent clock-change time is omitted individually and flagged in Connections for correction. An unknown end time does not acquire an invented duration.

Date-only hotel end dates mean checkout and are exclusive. Other date-only end dates represent the final included date. Date-only plans have no timed alarm. Timed plans default to a 15-minute display alarm; the event editor supports no reminder, at-start and other intervals. Manual reminder choices survive proposed booking amendments.

Apple Calendar chooses when to refresh. Keep Event Alerts enabled if reminders are wanted, and test actual refresh and alarm behaviour before relying on them for travel. The implementation does not promise an iPhone refresh interval. [Apple subscription settings](https://support.apple.com/en-ie/guide/iphone/iph3d1110d4/ios)

## Review alerts

The standalone manifest, Home Screen icons and notification service worker make the web app installable. On iPhone, open it from the Home Screen and explicitly tap Enable review alerts. iOS 16.4 or later is required. Existing notification permission is never requested automatically. The service worker does not cache private pages or API responses. [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [WebKit support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

Alerts contain generic text only and open the authenticated Review screen. They cover new suggestions after opt-in, group after two minutes of stable results and wait from 22:00 to 08:00 London time. Existing suggestions and an import already in progress at opt-in are baselined to avoid historical floods. No event-reminder pushes are scheduled, avoiding duplicates with Calendar alarms. Gmail still checks hourly.

Subscriptions and the outbox use the existing encrypted store. There are at most five subscribed devices. Delivery allows three bounded attempts, a one-hour expiry/TTL, invalid-subscription cleanup and explicit safe error status. The push transport validates supported provider endpoints, rejects private network destinations, pins the checked DNS address and retains normal TLS verification. An uncertain in-flight delivery after a restart is not replayed; a generic review alert may consequently be missed. A provider's success response does not prove that the phone displayed a notification. [Web Push protocol](https://www.rfc-editor.org/rfc/rfc8030), [web-push library](https://github.com/web-push-libs/web-push)

Turn alerts off on this device or everywhere in Connections. Sign-out immediately clears private UI state and attempts both server revocation and browser unsubscribe before leaving, with a bounded wait. Device settings provide an additional off switch if a network failure prevents full cleanup.

## Configuration and verification

Backend settings: `CALENDAR_PUBLIC_ORIGIN` for the HTTPS feed origin; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` for push. Keep VAPID keys stable across deployments. Private keys never enter the frontend environment. WhatsApp remains disabled independently.

Verification covers independent ICS parsing, token lifecycle, source exclusion, time zones, revisions, reminders, owner/origin checks, malicious notification payloads, denied permission, failed subscription save and offline sign-out cleanup. Synthetic browser checks exercise link creation, replacement and revocation through the real frontend/API/storage flow, without altering personal data. Locked-phone delivery, Focus behaviour, installed-app sign-in and real Apple Calendar refresh/alarms remain pending on the owner's device.
