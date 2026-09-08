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

The implementation is committed as `df9718a` on `codex/automatic-invitations`. Its Vercel preview build is READY under the verified `rorylm1` account. Production remains on `d4abd01`: backend rollout and existing-pending application have **not** happened.

Backend deployment attempts stopped during read-only preflight checks because SSH access repeatedly stalled. An authenticated production state request also returned 503 after approximately 20 seconds. Both calendar services were active during a successful host check, but the shared host had severe memory stalls (one-minute full memory pressure about 68%, load average about 19). The existing calendar-only memory protection is insufficient under that load. No unrelated process was stopped, no swap or capacity change was made, and the existing events, credentials, feed grant and notification preferences were untouched.

The existing background task will retry access with a bound. After access recovers: inspect memory and available compression support; deploy the backend with `--preserve-env`; run the authenticated preview, then explicit application; verify saved-event and subscription preservation; push the tested release to `main`; and check the Vercel API and private feed. A conditional temporary RAM-only zram trial can be evaluated without writing private heap contents to disk; support and benefit must be verified before claiming recovery. See the [kernel zram documentation](https://docs.kernel.org/admin-guide/blockdev/zram.html). Do not disable an in-use swap device while memory remains exhausted.

The verified backup and count-only preview report are in ignored `ops/local/`. The live migration helper is also private and uses the running service endpoint; it has not been executed. No additional Gmail scan or paid model run is needed for this migration.
