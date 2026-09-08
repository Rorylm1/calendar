# Automatic entry and invitation titles

Rory’s 8 September 2026 decision replaces routine approval with automatic addition. Supported dated bookings and invitations appear in the same calendar. Invitations use the exact `INVITATION: ` title prefix in the web app and the existing iPhone subscription. There are no separate attendance colours or subscription links.

## Behaviour

Booking confirmations, tickets, registrations and explicit acceptance support confirmed attendance. An invitation alone does not. Generic advertising and receipts for completed spending are excluded; a receipt that establishes a future reservation still counts. Missing or conflicting factual details, uncertain update/cancellation matches and conflicts with owner edits remain in **Needs details**.

Editable titles stay unprefixed. **I’m going** changes attendance and removes the presentation prefix without sending an RSVP. The action is reversible and uses the event’s revision to avoid overwriting newer changes. Invitation entries in the feed are tentative, transparent/free and alarm-free. Confirmed entries retain their reminder preferences. Event identifiers stay stable when attendance changes.

Automatic processing records the original attendance evidence, source chronology and application outcome. It preserves explicit edits, attendance choices, dismissals and deletions. Legacy saved events without automation provenance are protected from automatic replacement or cancellation. Duplicate input, older changes and transactional retries do not create additional entries.

Optional push alerts now say “Your calendar has new updates.” They group actual automatic changes and items needing details, omit booking information and keep existing opt-in and overnight quiet hours. Duplicate or suppressed candidates do not produce a new alert.

## Existing pending items

The authenticated `POST /v1/proposals/apply-pending` operator endpoint previews by default. Only `{ "dryRun": false }` applies eligible existing items. It uses the running service’s Store and transaction; it does not rescan Gmail or call a model. Normal processing applies only newly captured candidates, with no automatic startup migration.

Back up before applying the existing queue. Test the preview, application, preservation of saved events and a repeated no-op on a disposable copy. Do not construct a second Store against the running production database: its startup recovery changes processing-source state. Keep credentials, source content and feed links out of logs and the public repository.

## Verification

- 140 backend tests and 47 web tests pass, with type checks and a production frontend build.
- Independent review reran unresolved-fact, cancellation-identity, venue-duplicate, stale-update and owner-metadata regressions. An injected write failure verifies full rollback and safe retry.
- Fictional browser checks cover automatic booking/invitation addition, month/day/detail labels, unprefixed editing, attendance changes in both directions, invitation filtering, disabled invitation alarms, and completing a missing-date invitation without confirming attendance. The final 390 px viewport has no horizontal overflow.
- Feed tests parse the output and verify stable identifiers, invitation prefixes/status/free time, absence of invitation alarms, legacy grants, revocation and rotation.
- A verified production backup preview preserves all 15 existing events, adds eight eligible pending items and leaves eight needing details. Repeating the application makes no changes. This preview uses a disposable database and no provider calls.

Actual iPhone subscription refresh and device notification delivery remain to be observed on Rory’s phone. Synthetic lifecycle tests do not establish interpretation accuracy across all real mail.

## Rollout status — 8 September 2026

The implementation was committed as `df9718a` and passed its Vercel preview build under the verified `rorylm1` account. Initial backend deployment attempts stopped during read-only preflight because SSH access stalled under severe host memory pressure. Subsequent kernel logs identified recurring TradeR jobs being killed for exhausting memory; see [the server investigation](calendar-reliability.md).

After access recovered, backend release `20260908T092929Z` was deployed with configuration bytes, database identity and protected unrelated service processes preserved. Authenticated preview and application through the running service added eight eligible existing items: 23 saved events, eight remaining factual exceptions, all 15 original events unchanged. Repeated preview produced no further mutations. The existing private feed returned 200 with all 23 events and no blocked entries; its URL and push preferences were unchanged. Push remains off. None of the eight safely applicable existing items was an invitation; the remaining invitation candidates require factual corrections, so none was guessed into the calendar.

No extra Gmail scan or paid model call was requested. Source data, the verified backup and count-only migration report remain under ignored `ops/local/`. Production Vercel deployment `dpl_4rQMbHQsTs7iPDHtZUNppPTJsqSu` is READY for main commit `10b0ad3`. The authenticated page returned 200 with the automatic-entry copy and invitation filter. The corresponding state request returned 503 after about 21 seconds during recurring host pressure, so hosted API reliability remains unresolved despite successful deployment and earlier backend/feed verification. Actual iPhone refresh and device delivery remain pending.
