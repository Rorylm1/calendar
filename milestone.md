# Personal calendar — milestones

Updated: 7 September 2026. Based on [plan.md](plan.md). The private Edge app and always-on backend are deployed. Local API checks, 112 backend tests, a live synthetic model pair, and remote storage/restart checks have passed. Google setup and account-holder consent are complete. Gmail is connected, the initial import is complete, and hourly checks are active. The private calendar feed and opt-in review alerts are implemented; actual WhatsApp forwarding and iPhone device acceptance remain pending. Backup/restore verification and a synthetic evaluation corpus advance independently while Rory is away. Real suggestions are available in Review.

## Objective

Build a beautiful personal calendar that turns forwarded WhatsApp messages and Gmail into reviewed commitments and dated bookings, with confirmed events available in the iPhone Calendar app. Reduce manual entry, keep uncertain attendance explicit, and produce something Rory enjoys using and sharing.

## Current sequence — iPhone delivery and reliability while Rory is away

The Edge app is on Vercel and the Gmail service is running on Hetzner. Rory has authorized continued milestone work while away. The official WhatsApp receiver is deployed disabled; its real test awaits Meta account access and must fit the no-extra-owned-number constraint. The private ICS feed, installable app and opt-in review alerts are implemented. Device delivery and real-mail quality acceptance remain open. Continue reliability and fictional evaluation work without confirming personal suggestions or changing real bookings.

- [x] Build and review visual alternatives; select Edge as the working direction.
- [x] Implement the Edge personal app, encrypted persistent calendar/review data, and owner-restricted API bridge; preserve the original ten design studies.
- [x] Verify the local API flow: manual create/edit, clearing optional fields, stale-revision HTTP 409, delete, and owner/origin restrictions.
- [x] Pass 53 synthetic backend tests and a live fictional triage/extraction pair through OpenRouter; record the pair's $0.00507645 provider-reported cost.
- [x] Finish the private remote deployment and verify the hosted API/access flow, trusted TLS, and database persistence through restart.
- [x] Configure Google project, read-only scope, OAuth redirects, public app information, and Production status; reach the Google consent flow from the hosted app.
- [x] Complete account-holder consent and verify the connected Gmail profile.
- [x] Capture and interpret real emails, produce dated suggestions for review, and recover the saved import from Gmail rate limiting with paced reads.
- [x] Add and test automatic saved-import continuation, queued manual checks, and cancellation of provider waits on disconnect.
- [x] Finish the initial import; verify the saved history checkpoint, no active import scan, and successful scheduled capture with the next check one hour later.
- [ ] Complete real-mail accuracy acceptance; failed interpretations are retained for retry.
- [x] Resume WhatsApp feasibility and iPhone notification research after Gmail became useful.
- [ ] Receive an actual forward using the supplied Meta test number and establish whether it avoids ongoing number administration.

These checks distinguish implementation from acceptance: real-mail accuracy and iPhone behaviour remain unverified; completed import and hourly scheduling have now been observed. Remote deployment checks are documented in [ops/README.md](ops/README.md); the model pair confirms API compatibility only. No whole Gmail or iPhone milestone is complete.

## Ownership and working agreement

| Area | Owner |
| --- | --- |
| Visual direction, layouts, typography, colours, motion, responsive behaviour, and presentation components | Rory with Codex |
| Backend, storage, authentication, Gmail/WhatsApp integrations, model interpretation, calendar feed, deployment, and reliability | Codex |
| Frontend data fetching, form behaviour, validation, review actions, connection flows, and integration with real services | Codex, preserving Edge |
| Product choices, account setup requiring the account holder, design acceptance, and actual iPhone checks | Rory, with implementation support from Codex |

Rory directs the design with Codex implementing it. Edge is the current visual reference in [design.md](design.md); functional wiring should preserve its layout and restraint. This ownership applies throughout the milestones.

## Overview

| Milestone | Reviewable result | Main dependency |
| --- | --- | --- |
| 1. Prove WhatsApp forwarding | Evidence that the official receiver works, or a clear setup limitation | Meta account access and a test receiver |
| 2. Build the calendar foundation | Designed calendar and review interface with working manual events | Shared data format; design and backend can proceed alongside milestone 1 |
| 3. Connect iPhone Calendar | Confirmed events available through a private subscription, with reminder behaviour verified | Milestone 2 and an HTTPS endpoint |
| 4. Capture Gmail bookings | Hourly email → review → calendar; iPhone integration required for the full daily-use result | Milestone 2 and Gmail/model setup; milestone 3 can follow initial Gmail use |
| 5. Complete WhatsApp capture | Forward → interpret → confirm in WhatsApp or the app → calendar | Milestones 1–4 |
| 6. Prove everyday reliability | Private version that survives failures and is useful in daily use | Milestones 3–5 |
| 7. Publish the showcase | Polished public demo with fictional data | Stable interface and isolation verified; personal-use feedback informs polish |

The milestone numbers identify work areas, not the current execution order. The calendar foundation and Gmail are deployed; current work advances calendar delivery and reliability while WhatsApp account access is pending. The WhatsApp proof remains timeboxed to one evening when resumed. Milestones are defined by working outcomes rather than speculative dates; Rory's design review can proceed alongside backend and account setup.

## Milestone 1 — Prove the official WhatsApp receiver

**Owner:** Codex; Rory supplies account access and completes account-holder setup where necessary.

**Purpose:** Determine whether forwarding can be useful without another number to buy or manage. Meta supplies the candidate test receiver; its suitability for ongoing personal use is unproven. Do not buy a SIM, migrate the personal account or substitute Baileys. See [the spike findings](docs/whatsapp-spike.md).

- [x] Build and deploy the minimal signed webhook in its disabled state with a separate encrypted spike inbox; 13 new tests cover authentication, allowlists, replay, persistence and limits.
- [ ] Obtain the Meta-provided test receiver and complete a real delivery check.
- [ ] Forward an actual text message from Rory's normal WhatsApp account and inspect the content and context delivered.
- [x] Verify webhook authentication and sender/receiver restrictions with synthetic payloads.
- [ ] Verify the actual Meta signature and sender restriction with a real forward.
- [ ] Establish test-receiver availability, real inbound delivery and unattended operation under the no-extra-owned-number constraint. Document production-number and eligibility requirements as limits, not as an approved purchase or migration.
- [ ] Record missing context, particularly original sender/date and surrounding conversation.
- [ ] Stop after the timebox and record either a workable route or the specific unresolved setup issue. Continue independent calendar/Gmail work if onboarding remains blocked.

**Done when:** A real forward reaches the official webhook and the ongoing-use path fits the no-extra-owned-number constraint, or a clear incompatibility is recorded for a product decision. If this cannot be demonstrated, leave the milestone incomplete with a clear finding; do not substitute Baileys or a personal-account scraping connection.

**Design handoff:** Rory and Codex refine the actual capture states: received, processing, needs clarification, ready to review, and failed.

## Milestone 2 — Build the calendar foundation and design handoff

**Owners:** Rory + Codex for design; Codex for the application foundation and functional wiring.

**Status:** Local implementation, API checks and hosted owner access pass. Interaction acceptance and Rory's review of the functional app remain pending.

### Codex: make the interface independent of live integrations

- [x] Define shared data contracts for events/bookings, proposals, source evidence, connection status, and user actions in the frontend and [service API](server/API.md).
- [x] Preserve the ten fictional design studies and their calendar/review interactions independently of the personal calendar.
- [x] Exercise timed/date-only bookings, multi-leg journeys, missing dates, attendance uncertainty, duplicate confirmation, and stale updates in synthetic backend tests.
- [x] Implement owner-restricted access, encrypted storage, the calendar/review API, and manual event creation, editing, and deletion; verify those API operations locally.
- [x] Implement confirm, edit, and dismiss actions, with transaction/idempotency and stale-update protection verified by synthetic tests.
- [ ] Complete the functional app's interactive acceptance checks, including generic bookings, amendments, cancellation review, and all important loading/error states.

### Rory + Codex: create and refine the frontend design

- [x] Explore ten alternatives and select Edge as the working month-first design.
- [x] Implement Edge's selected-day panel, event details/forms, review inbox, and Gmail connection screens at `/calendar`.
- [x] Implement evidence, attendance wording, missing-detail correction, confirmation/dismissal, and cancellation-review states.
- [ ] Review empty, loading, disconnected, processing, and error states in the functional app with Rory.
- [ ] Verify responsive behaviour, keyboard controls, and reduced motion on the agreed phone and desktop sizes.

### Integration handoff

- [x] Connect the Edge components to the calendar service and real API actions while preserving the visual treatment.
- [ ] Rory reviews the result for design consistency; Rory and Codex refine the interface together.

**Done when:** Rory can create and manage manual events in the hosted app, review proposals, and see only confirmed items on the calendar. Date-only bookings and multi-day stays display without invented times. The original fictional studies remain available for further design comparison.

## Milestone 3 — Make it usable through iPhone Calendar

**Owner:** Codex; Rory verifies the subscription on the actual iPhone. Rory and Codex refine the subscription/settings presentation.

**Status:** Private ICS subscriptions, per-event reminder settings, Home Screen manifest/icons and opt-in grouped review alerts are implemented. Synthetic tests and the browser subscription-control flow pass. Both features remain off until the owner enables them. Physical iPhone push delivery and Calendar refresh/alarms are unverified. See [delivery implementation](docs/calendar-delivery.md) and [iPhone findings](docs/iphone-notifications.md).

- [x] Establish an isolated HTTPS calendar service on Hetzner and verify access/capacity. The token-protected feed endpoint is now implemented.
- [x] Publish confirmed events through a read-only ICS feed with stable event identifiers, revision tracking, and correct date/time representation.
- [x] Protect the subscription with an unguessable, revocable token. Explain that possession of the URL grants access to the exported event details; keep source messages and credentials out of the feed.
- [x] Include per-event alarms, with the planned 15-minute default for timed events and no invented time-based alarms for date-only bookings.
- [x] Add the subscription instructions and reminder settings to the designed interface.
- [x] Implement the away-work default: an installable app with optional grouped review alerts and event alarms through the private feed. Permission remains an explicit device action; no duplicate event-reminder pushes. Rory can refine this preference after trying it.
- [ ] Verify installation, permission, locked-phone delivery, tap-through, denial and revocation on the actual iPhone.
- [ ] Verify a restaurant reservation, overnight flight, hotel stay, and date-only booking on the actual iPhone.
- [ ] Measure how additions, edits, and cancellations refresh on the device, and verify whether subscribed-calendar alarms behave as intended under Rory's settings.

**Done when:** Confirmed events render correctly on the iPhone, changes and cancellations behave as tested, and reminder behaviour is demonstrated. Record observed refresh delays and settings. Do not promise instant updates or rely on untested alarms; resolve any unreliable behaviour before treating this as the daily reminder mechanism.

**Usable result:** Confirmed manual and reviewed Gmail events become available through an iPhone subscription, with refresh and reminder behaviour verified on Rory's device.

## Milestone 4 — Capture Gmail commitments and all dated bookings

**Owner:** Codex; Rory and Codex refine any additional review/connection states needed.

**Status:** The implementation is deployed and Google configuration is complete. The owner completed consent, and the expected mailbox is connected. The saved import is complete and hourly capture has been observed. Real-mail accuracy and iPhone acceptance remain open; live mailbox counts stay in the private app.

- [x] Implement read-only offline OAuth with owner-bound expiring state, PKCE, allowed-mailbox profile enforcement, encrypted tokens, and disconnect protection; cover these safeguards with synthetic tests.
- [x] Complete Google configuration, read-only scope, exact redirects, and Production publishing status for personal use.
- [x] Complete account-holder consent and verify the authorized Gmail profile.
- [ ] Verify token refresh and continued scheduled access during real use.
- [x] Implement the initial 30-day scan, hourly synchronization, resumable checkpoints, explicit Check now, and visible status/error fields; test recovery using a mocked Gmail provider.
- [x] Extract readable bodies, including bounded detached text parts, and preserve relevant thread/forward content while removing redundant quoted replies.
- [x] Build fresh model interpretation with concise instructions, strict structured output, and application validation; avoid porting iFlight's extraction rules.
- [x] Configure **Gemini 3.5 Flash Lite** (`google/gemini-3.5-flash-lite`) triage and **Gemini 3.6 Flash** (`google/gemini-3.6-flash`) extraction through OpenRouter. Pass uncertain triage onward and retain an audit of filtering decisions.
- [x] Use the [stateless Responses API](https://openrouter.ai/docs/api/reference/responses/overview) with `store:false`, [strict structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), parameter-support requirements, and `data_collection:deny` provider routing. Fail visibly if no eligible provider exists.
- [x] Pass the live fictional booking pair with these exact models/settings; record total provider-reported cost **$0.00507645**. This is an API compatibility check, not real-mail quality validation.
- [x] Implement the configurable **$5 monthly guard**, conservative cost reservations, visible pauses, and retention of captured work; validate the guard in synthetic tests.
- [x] Implement ordinary single-event calendar attachment parsing and incomplete review items for relevant unsupported attachments; prevent short image adverts from bypassing triage.
- [x] Keep creates, amendments, and cancellations subject to confirmation, with source evidence and missing details; test idempotency, separate travel legs, and revision protection synthetically.
- [ ] Verify real hourly capture through review and confirmation, including real confirmations mixed with advertising or labelled Promotions/Updates.
- [ ] Evaluate social plans and every major booking type, plus invitation/acceptance/refusal, duplicates, receipts, amendments, and cancellations using real or appropriately sanitized examples.
- [ ] Measure real-mail quality, latency, correction effort, triage misses, and running cost before revisiting models or the budget.

**Done when:** A real booking email reaches the review inbox on the next successful hourly run, confirmation produces one correct calendar event, and that event is included in the iPhone feed. Demonstrate each major booking type plus an advert, ambiguous invitation, acceptance reply, duplicate, amendment, and cancellation. No mandatory details are fabricated and no event is confirmed without Rory's action.

**Usable result:** The first version that saves daily calendar-entry effort. Begin private use here while WhatsApp is completed.

## Milestone 5 — Complete WhatsApp capture and confirmation

**Owner:** Codex; Rory and Codex refine related app screens and clarification flows.

- [ ] Complete production receiver setup from milestone 1 and restrict capture to Rory's sender identity.
- [ ] Persist messages before acknowledging delivery and process them through a durable queue. Make retries harmless.
- [ ] Use the same interpretation and proposal logic as Gmail, with explicit forwarded-message provenance.
- [ ] Associate related forwards and follow-up context carefully; request clarification when the intended event or original date is unclear.
- [ ] Offer in-chat confirm/dismiss buttons for suitable proposals, showing enough event detail for an informed decision. Use explicit wording when confirmation also means choosing to attend.
- [ ] Route incomplete or ambiguous proposals to the web review inbox. Use the same confirmation operation in both places.
- [ ] Keep acknowledgement and interactive replies within the permitted messaging window. If processing finishes after that window, retain the proposal in the app; do not assume a free-form WhatsApp reply can still be sent.
- [ ] Handle forwarded changes and cancellations as reviewed updates. Explain that unseen changes in the original chat cannot be detected.

**Done when:** Rory can forward a message, inspect the proposed details, and confirm one correct event from either WhatsApp or the app. Confirming in both places still produces one event. A forwarded “tomorrow” with no original date needs clarification, and a later change takes effect only after it is forwarded and approved.

## Milestone 6 — Prove everyday reliability

**Owner:** Codex for engineering; Rory for daily use and feedback; Rory and Codex for design refinements.

- [x] Pass the synthetic backend suite, including interrupted Gmail pagination, expired checkpoints, OAuth/disconnect safeguards, model failures, queue fairness/retries, chronology, retention, and budget controls.
- [x] Verify local API owner/origin checks and manual create/edit/optional-field clearing/stale-409/delete behaviour.
- [ ] Exercise the deployed service's restart/recovery paths with real integration configuration; test WhatsApp replay once its receiver exists.
- [ ] Verify accepted input is retained, failed work can retry, and connection or processing problems are visible.
- [x] Verify synthetically that stale proposals cannot overwrite manual edits and that approved changes/cancellations produce correct feed revisions and alarms; device refresh remains under milestone 3.
- [x] Verify encrypted storage, owner/origin access, synthetic retention and redacted errors, feed-token revocation, online backup and isolated integrity/decryption restore checks. One real snapshot was copied off-host and verified without changing the live database.
- [x] Install and verify daily server backups, including a snapshot while the live database has an active WAL. Scheduled copies are host-only; off-host copying is a separate verified operator step.
- [ ] Preserve and verify an independent recovery copy of the encryption key and rehearse complete application/provider recovery; isolated database verification alone does not establish this.
- [ ] Use the app privately for an initial week and record missed relevant items, irrelevant suggestions, correction effort, and measured running cost.
- [x] Build a labelled set of 50 synthetic examples with an offline validator, field scorer and guarded model runner. Cases cover all major bookings, receipts, adverts, attendance, changes and duplicates; labels and scenario IDs stay out of model input.
- [ ] Measure the 50-case model baseline, inspect mismatches and track precision/recall including triage misses. Synthetic coverage does not establish real-mail accuracy.
- [ ] Fix failures that cause lost messages, duplicate events, invented details, unapproved writes, or misleading reminder behaviour before calling the private version dependable.
- [x] Keep grouped review push opt-in, baseline existing suggestions, use overnight quiet hours and expose an off switch. Actual review habits and device delivery remain to be evaluated; no event-reminder fallback has been added.

**Done when:** The complete capture/review/calendar flow has worked during ordinary use, recovery and restore have been demonstrated, and remaining limitations are documented. Rory can tell when data is stale or action is required.

## Milestone 7 — Polish and publish the fictional demo

**Owners:** Rory + Codex for final design and storytelling; Codex for demo wiring, isolation, verification, and deployment preparation.

- [ ] Polish the designed flows using feedback from private use, including mobile behaviour, accessibility, empty states, and motion.
- [ ] Build a separate fictional dataset and demo mode with no live Gmail/WhatsApp connections, personal feed tokens, source messages, or personal records.
- [ ] Demonstrate the story end to end: a message or booking becomes a suggestion, the user reviews it, and it appears on the calendar.
- [ ] Verify the demo cannot call personal services or expose credentials through any route or client asset.
- [ ] Prepare the public deployment and a short walkthrough describing what works and the deliberate limits. Rory decides when it is ready to share.

**Done when:** The approved demo is published, can be explored without connecting accounts, demonstrates the core experience, and preserves the frontend design developed by Rory and Codex.

## Scope boundaries

Keep native iPhone development, two-way calendar synchronization, task lists, recurring-event series, image/voice/PDF extraction, live transport status, fare tracking, travel purchases, automatic RSVPs, and multiple real users outside these milestones.

Account setup and implementation are now authorized. Purchases still require explicit authorization. Real account and device checks must be distinguished from tests with fictional data.
