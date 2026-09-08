# iPhone notifications

Researched against current Apple and WebKit guidance on 7 September 2026. The calendar feed, installable app and opt-in review-alert infrastructure are now implemented; see [calendar delivery](calendar-delivery.md). No physical iPhone notification delivery, subscription refresh or alarm behaviour has yet been verified.

## Current product update — 8 September 2026

Rory now wants automatic entry with `INVITATION: …` labels in one calendar, using the existing subscription. Invitations are tentative/free and have no alarms. The colour-coded, separate-subscription idea was superseded. Optional alerts now concern calendar updates and missing details; the device checks below still apply, with tap-through to the calendar.

## Objective

Let the owner notice new items requiring review and receive useful reminders for confirmed plans, while preserving the quiet Edge experience. While the owner is away, the implemented default is opt-in grouped review alerts plus confirmed-event alarms through the private subscription. Neither is enabled without the owner's action; the preference can still be adjusted.

## Confirmed platform facts

| Question | Current documented answer |
| --- | --- |
| Can the existing web app notify an iPhone? | Yes. Web Push is supported for **Home Screen web apps from iOS/iPadOS 16.4**. A normal iPhone Safari tab is not the documented supported surface; installation and permission are required. [WebKit introduction](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| How does installation work now? | In Safari, open Share, choose Add to Home Screen, leave Open as Web App enabled, then Add. Open the resulting icon. iOS 26 defaults added sites to web-app mode, even without a manifest. Keep an explicit standalone manifest and icons for older supported versions and a consistent identity. [Current iPhone instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), [Safari 26 changes](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#every-site-can-be-a-web-app-on-ios-and-ipados) |
| Is Safari the only installation route? | From iOS 16.4, other eligible browsers can offer Add to Home Screen. For the first device test, use Apple's documented Safari flow. [WebKit browser support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| When can permission be requested? | Immediately from a deliberate user gesture, such as tapping Enable notifications. Registration must bind the returned endpoint and encryption keys to the authenticated user. The conventional implementation receives pushes in a service worker and displays them with the Notifications API. [Apple Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) |
| Do we need a native app, APNs certificates or paid Apple membership? | No native application or Apple Developer Program membership is needed for standard Web Push. Apple's delivery infrastructure uses APNs behind the browser subscription; our server uses Web Push/VAPID rather than a native application's APNs registration. [WebKit implementation guidance](https://webkit.org/blog/16535/meet-declarative-web-push/) |
| Can a push silently wake the app to scan email? | No. Safari requires a visible notification; conventional handlers that fail to display one can lose permission. Email capture remains a server job. [Apple Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) |

**Newer option:** Declarative Web Push is available to Home Screen web apps on **iOS/iPadOS 18.4+**. A structured payload supplies the notification and destination directly, so display does not depend on service-worker JavaScript succeeding. A conventional service worker can handle the same format on older browsers. This improves display resilience, not network delivery guarantees. [Apple WWDC25 guidance](https://developer.apple.com/videos/play/wwdc2025/235/), [WebKit details](https://webkit.org/blog/16535/meet-declarative-web-push/)

**Delivery has limits.** Offline devices can receive stored pushes later, subject to expiration and limited storage. Web Push supports a TTL and optional topic for coalescing. A successful send is not proof that an alert appeared. Focus also applies to Home Screen web apps. Native notification APIs do not establish an exact-time delivery guarantee either. [Apple Web Push delivery](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [WebKit Focus support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple User Notifications](https://developer.apple.com/documentation/usernotifications/)

## Calendar subscriptions and reminders

Apple Calendar on iPhone accepts external read-only `.ics` subscriptions. Apple explicitly documents an **Event Alerts** switch for subscribed calendars. This makes the planned confirmed-events feed a plausible reminder route, but does not prove how our particular `VALARM` values will behave. [iPhone subscription and alert settings](https://support.apple.com/en-ie/guide/iphone/iph3d1110d4/ios)

Calendar-wide notification settings also control presentation. Mac Calendar separately exposes subscription auto-refresh and options to remove or ignore alerts. These Mac controls do **not** establish an iPhone refresh interval. The reviewed iPhone guidance gives no bounded refresh guarantee for arbitrary external feeds; measure additions, edits and cancellations on the actual phone. Do not promise instant synchronization or treat a requested feed refresh interval as enforceable. [iPhone notification settings](https://support.apple.com/en-ca/guide/iphone/iphdafdf98a1/ios), [Mac subscription settings](https://support.apple.com/en-gb/guide/calendar/icl1022/mac), [Mac refresh guidance](https://support.apple.com/guide/calendar/refresh-calendars-icl1024/mac)

## Recommended first version — product judgment

1. **Make Edge installable and send grouped review alerts.** After a processing batch creates new pending items, send one quiet summary linking to Review. Suppress historical-import floods and repeated alerts for unchanged items. Keep Gmail's hourly capture schedule; push does not make new emails discoverable sooner.
2. **Keep confirmed plans available through the planned ICS feed.** Test its event alerts before relying on them. Avoid duplicate reminders from both Calendar and the web app by default.
3. **If event push reminders are wanted, schedule them on the backend.** Key each reminder to the confirmed event and revision; cancel or replace queued reminders after changes. Give late reminders a short useful lifetime. Do not use a browser timer or invent a time for a date-only booking. A native client is a later option if device tests demonstrate a need for its local scheduling capabilities.
4. **Use discreet notification text initially.** For example, “New plans are ready to review.” Keep mailbox content, reservation references and travel details off the Lock Screen by default. Store subscriptions privately, provide an off switch, remove invalid endpoints, and require owner sign-in when opening private details.

## Pending checks on the owner's iPhone

- Record iOS version; install from the final HTTPS origin; verify Google sign-in works inside the installed app.
- Enable notifications through a tap; test denied permission, later settings changes and removal/reinstallation.
- Deliver a fictional grouped review alert with the app closed and phone locked; verify tap-to-Review and no exposure before authentication.
- Check Focus, sound settings, offline/reconnect, expired messages, duplicates and disable/sign-out behavior. Record observed delays; do not infer a guarantee from a few successes.
- Subscribe to a fictional confirmed-events feed. Verify restaurant, date-only hotel and cross-zone overnight flight representations, alert timing, and update/cancellation refresh with Calendar closed.
- Test late amendments and removal of an already scheduled alert. Choose one default reminder channel only after these checks and the owner's notification preference are settled.
