# Personal calendar — implementation plan

Updated: 7 September 2026. The private Edge calendar and always-on backend are deployed; the original ten design studies are preserved. Calendar/API checks, the selected model pair, and remote storage/restart checks have passed. Google setup and account-holder consent are complete. Gmail is connected; the initial import has completed and hourly checks are active. The next spike evaluates WhatsApp forwarding without another number to buy or manage. Real suggestions are available in Review.

## Objective

Build a beautiful, delightful personal calendar that makes it easy to turn scattered commitments and bookings into a reliable view of what Rory is actually doing. Reduce manual calendar entry by understanding forwarded WhatsApp messages and Gmail, capturing any booking with a relevant date, and making uncertain details quick to review.

Success means less effort keeping the calendar accurate, fewer missed commitments, and an app Rory enjoys using daily and is proud to share as a design and engineering project. A capable model should handle the interpretation with concise instructions and relevant context; the product should stay focused and simple to maintain.

Rory directs the product and design with Codex implementing the design, frontend, backend, and integrations. Edge is the working visual direction; further refinements remain open to Rory's feedback.

## Verified progress

- The Edge personal frontend, owner-restricted Vercel API bridge with Google identity sign-in, encrypted calendar storage, manual event forms, and proposal review flows are implemented. The personal calendar starts empty; fictional bookings stay in the design studies.
- Local API checks passed for manual creation, editing, clearing optional fields, rejecting stale revisions with HTTP 409, deletion, and owner/origin restrictions. These establish the local API flow; they do not establish production access or actual iPhone behaviour.
- **53 backend tests pass** using synthetic data. They cover calendar/proposal operations, Gmail capture and recovery, OAuth safeguards, parsing, queue failures, retention, and budget controls. Real inbox quality still needs evaluation.
- Two live OpenRouter calls using fictional booking text passed: Gemini 3.5 Flash Lite triage and Gemini 3.6 Flash extraction. Strict structured output and the configured provider restrictions were accepted; the combined provider-reported cost was **$0.00507645**. This establishes model/API compatibility, not a monthly cost forecast or real-mail accuracy.
- The private Next.js app on Vercel and isolated Hetzner backend are live; source is published at Rorylm1/calendar. Hosted connection state and OAuth initiation work; trusted HTTPS, unauthenticated API rejection, and SQLite persistence through a service restart were verified. See [deployment notes](ops/README.md).
- Google OAuth is configured for ongoing personal use and read-only Gmail. The owner completed consent and the expected Gmail profile was verified; see [Google setup and handoff](ops/google-setup.md). The saved import completed, a Gmail history checkpoint is present, and hourly checks continue. Captured interpretation failures remain available for retry; real-mail quality acceptance continues; live mailbox counts stay in the private app. WhatsApp and the iPhone feed remain unverified. Implementation details and the model smoke record are in [server/README.md](server/README.md).

## 1. Agreed scope

The first version is a mobile web app for Rory, with a separate public demo using fictional data. A native iPhone app can reuse the backend later.

The core flow is **capture → understand → review → calendar**:

- Forward selected messages within WhatsApp to a dedicated calendar contact.
- Check one connected Gmail account automatically **once per hour**.
- Identify personal commitments and dated bookings, distinguish them from invitations and adverts, and prepare event suggestions.
- Let Rory confirm, edit, or dismiss suggestions before anything enters the calendar. Changes and cancellations also require review.
- Include flights, trains, restaurants, hotels, appointments, tickets, rentals, and other reservations with a relevant date.
- Support manual event creation, editing, and deletion.
- Publish a one-way subscribable ICS feed so confirmed events and their reminders appear in the iPhone Calendar app. This app stays the sole source of truth; the feed is read-only on the device. Two-way Apple/Google Calendar synchronization stays deferred.

The motivation is personal usefulness, design practice, and a shareable piece of work. Forwarding overlaps more with existing products such as [Fantastical's email capture](https://flexibits.com/blog/2025/06/feature-spotlight-forward-emails-to-fantastical/), so differentiation should come from a focused experience and reliable interpretation. Do not expand this into a general personal agent.

## 2. WhatsApp: forward to a calendar contact

### User experience

1. Save the app's dedicated WhatsApp number as a contact, provisionally called **My Calendar**.
2. Use WhatsApp's normal Forward action to send it a relevant text message or several relevant messages.
3. The app receives the forwarded content and prepares suggestions. A short acknowledgement links to the review inbox; confirmation happens in the web app.
4. Open the suggestion, check the details and attendance status, then confirm or dismiss it.
5. Forward later changes too. The app cannot discover changes in a conversation it has not received.

Forwarding means **“please look at this”**, not **“I am attending.”** An optional extra message such as “I'm going” or “just considering this” can clarify intent. Follow-ups must be associated with the right suggestion; if that association is unclear, ask in the review interface.

### Integration approach

**Updated constraint:** Rory does not want another phone number to buy or manage. The current spike uses only a Meta-provided test receiver if available. It does not authorize buying a number, moving the personal WhatsApp account, or assuming a test asset is a permanent service. See [WhatsApp spike findings](docs/whatsapp-spike.md).

- Use the **official Meta WhatsApp Cloud API** with a signed webhook on the existing backend. A receiving calendar contact is needed for forwarding inside WhatsApp; the test contact would be supplied by Meta.
- Meta developer/WhatsApp Business setup still applies. A normal personal WhatsApp account or its self-chat does not expose this incoming-message API.
- A production Cloud API receiver needs an eligible business number. Coexistence is a distinct option for eligible WhatsApp Business App onboarding, not a way to silently attach the personal account; its eligibility is unverified here. The previous assumption that Rory should buy a fresh SIM is superseded.
- Confirm actual account eligibility in Meta's dashboard. Do not assume that business verification, test assets or ongoing access will be granted.
- Keep the personal account as sender. Receive webhook deliveries without polling, verify exact-body signatures, and allow only the configured sender and receiver IDs.
- Persist each accepted message in an encrypted spike inbox before acknowledging the webhook. Deduplicate retries by provider message ID. Record unsupported media without downloading it.
- Keep this receiving proof separate from Gmail interpretation. A successful capture is not a proposal, attendance confirmation or calendar event.
- Later work can add careful grouping, interpretation, shared review/confirmation and explicit in-chat replies within Meta's allowed window. Outgoing messages and automatic replies are not part of the receiving spike.
- If the supplied test receiver proves unsuitable without additional number administration, assess copying selected text into an authenticated capture form. Do not claim that iPhone WhatsApp can share selected text into a Shortcut until demonstrated on the device.

### Context limitations

Do not assume a forward supplies the original sender, original message timestamp, full conversation, or proof of agreement. WhatsApp's documented forwarding context is limited. Preserve the content actually received and label it as forwarded by Rory. [Meta webhook context reference](https://www.postman.com/meta/whatsapp-business-platform/folder/hysdhqs/context-object)

In particular, “tomorrow at seven” in a forwarded message needs clarification unless the original date or other reliable context is present. The time the forward arrived is not necessarily the time the original message was written. A date of “Friday” may likewise need confirmation.

### Cost and feasibility

Direct Cloud API is the default to avoid a separate messaging provider's markup. Do not provision a paid number under the current constraint. Distinguish test setup from future AI processing and any applicable Meta messaging charges. Meta's pricing overview currently describes free service replies within a 24-hour user-initiated window, but production costs must be checked against the effective rate card before launch; do not promise that the integration is permanently free. [Meta pricing](https://whatsappbusiness.com/products/platform-pricing/)

A messaging intermediary would add another service to manage and does not automatically solve the receiving-number requirement. Reconsider one only if its concrete benefit fits the no-extra-number constraint.

The first milestone must prove that the supplied test receiver accepts a real forward and establish whether it fits the no-extra-number constraint; until then it remains a feasibility spike. If official onboarding is unavailable, report that limitation; do not quietly restore an unofficial personal-account connection.

## 3. Gmail: hourly capture with useful filtering

- Connect one Gmail account through read-only OAuth, including offline access for scheduled checks. Store refresh credentials securely and show when reconnection is needed.
- Run one scheduled synchronization each hour, plus an explicit **Check now** action. Do not run a hidden minute-by-minute mailbox poll or add Gmail push infrastructure for v1.
- On connection, inspect the last 30 days of mail for upcoming events and bookings. This is a bounded initial scan, not a complete historical import; older bookings may need manual forwarding or entry.
- After that, use Gmail history checkpoints to retrieve new messages and relevant changes. Persist fetched work before advancing the checkpoint. Resume paginated jobs after failures; if the checkpoint expires, perform a bounded recovery scan and disclose any uncovered gap. [Gmail synchronization guidance](https://developers.google.com/workspace/gmail/api/guides/sync)
- Include sent replies and relevant thread context to identify acceptance, refusal, changes, and cancellations. Avoid treating quoted old content as a new agreement.
- Exclude spam, trash, and drafts. Do **not** exclude Gmail's entire Updates, Promotions, or Social categories: real bookings and invitations can land there.
- Let the model interpret likely plans and bookings from the message and relevant context. Sender domains and subject keywords must not become hard gates that discard unfamiliar bookings or personal plans.
- Extract readable text before any model call: prefer `text/plain`, strip HTML to text otherwise, fetch bounded detached text bodies, remove tracking markup, and cap retained length. Remove quoted replies only when their text is already available in the supplied thread context; preserve forwarded booking details. Passing large raw HTML messages to the model wastes the AI budget.
- Run a cheap first-stage model that answers only whether the message describes a dated commitment or booking, then escalate the small remainder to the capable model for full extraction. This is a judgement made on the actual content, not a sender allowlist, so it does not conflict with the rule above. Log the triage decision so wrongly-dropped messages are discoverable.
- Deduplicate by Gmail message ID, then match related messages to existing proposals/bookings. A booking confirmation and its check-in reminder should normally support the same booking.
- Display last successful check, next scheduled check, pending work, and actionable connection errors.

Configure the OAuth consent screen concretely: set the app to **Production** publishing status, do **not** submit it for verification, and rely on the documented personal-use exception for restricted scopes. Accept the unverified-app warning screen once during authorization. An external app left in **Testing** issues refresh tokens that expire after seven days, so a successful initial login there is not durable authorization.

This matters because `gmail.readonly` is a restricted scope. Completing verification would require an annual third-party security assessment at a cost that is absurd for a single-user personal project, and the personal-use exception exists precisely to avoid it. Do not plan an IMAP app-password fallback: Google is phasing app passwords out through 2026 in favour of OAuth. [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) [Google OAuth guidance](https://developers.google.com/identity/protocols/oauth2)

## 4. Decide what belongs on the calendar

Keep three concepts separate: **what the message describes**, **whether Rory is participating**, and **whether Rory has approved saving it**. A high-confidence date extraction is not high-confidence attendance.

| Evidence in the content | Interpretation | Behaviour |
| --- | --- | --- |
| “See you Friday at seven” with Rory's explicit agreement | Agreed personal plan | Prepare a ready-to-confirm event. |
| “Come to my party on Saturday” without an answer | Invitation; attendance unknown | Show “Are you going?” in review; do not treat it as confirmed. |
| Rory explicitly declines or says they cannot attend | Not attending | Do not suggest a new confirmed event; propose cancellation if a matching saved event exists. |
| Reservation/ticket confirmation with a date and credible booking details | Dated booking | Prepare booking events and show the evidence, even if it is automated commercial email. |
| “Flights from £29,” a hotel promotion, or “what's on this weekend” | Marketing or general event information | Suppress by default; a deliberately forwarded item can be marked as an offer in review without assuming a booking. |
| Quote, availability search, pending reservation, or abandoned checkout | Unconfirmed interest/request | Never label it booked. Keep for review only when personally relevant. |
| “Your booking has changed” or “reservation cancelled” with a match | Booking update/cancellation | Propose a change to the existing record, not an unrelated new event. |
| Booking names only another person or is explicitly someone else's itinerary | Relevance uncertain | Ask whether Rory wants it on the calendar; do not infer participation from delivery to the inbox. |

Each proposal shows a short explanation and the supporting excerpt. The user can inspect the source, correct inferred details, or dismiss it. Dismissed proposals do not return on the next scan unless materially new evidence arrives.

Default calendar view contains only user-confirmed items. Invitations and incomplete details stay in the review inbox. Confirming an invitation explicitly records the user's decision to attend; it does not send an RSVP to the host or merchant.

Use a capable general-purpose model with a short instruction describing the task, the review policy, and the required output structure. Give it the actual message, relevant conversation context, and possible matching bookings. Let it interpret ordinary language and booking formats without a long catalogue of merchant-specific rules or elaborate prompts inherited from a simpler model. The table above describes expected behaviour and evaluation examples, not a script to reproduce verbatim in the prompt.

Keep structured output and application-side validation for dates, identifiers, duplicates, and permitted actions. These protect the calendar even when interpretation is good. Never fabricate dates, addresses, passenger identities, reservation references, or arrival times. A smarter model cannot recover context that was never forwarded: missing evidence should remain explicit and easy to resolve. Treat source content as untrusted data, with no access to tools that send messages, purchase travel, or alter bookings.

## 5. Support any dated booking

Use a generic booking model with optional details for particular types; do not hardcode the entire feature around airlines or a few merchants.

| Booking type | Calendar representation and useful details |
| --- | --- |
| Flights | One event per flight leg, linked to a common itinerary where supported by evidence. Preserve airline/flight number, airports, departure and arrival dates/times, local time zones, and booking reference. |
| Trains, coaches, ferries | Journey event with origin/destination, operator, travel date, departure/arrival times when supplied, and available seat/reference details. Do not require a flight-style service number. |
| Hotels and other accommodation | One stay spanning check-in to check-out, with property, address, reference, and supplied check-in/out times. Retain date-only stays when exact times are absent. |
| Restaurants | Reservation date/time, venue/address, party size, and reference if present. Absence of a reference does not invalidate an otherwise clear reservation. |
| Appointments, attractions, performances, activities | Dated appointment or ticket event with venue/provider and whatever confirmed details are supplied. |
| Rentals and other reservations | Preserve the relevant start/end or pickup/return dates. Use the generic booking type when a more specific category does not fit. |

Rules that apply across types:

- The relevant date is the date of the service, visit, stay, or journey, not the date an email was sent or payment was made.
- A receipt for a completed purchase or visit is not itself a commitment. Keep payment emails only when they also establish a reservation, ticket, or scheduled service. For example, buying drinks at a pub does not create a pub booking. Apply this generally, without excluding a particular venue or sender.
- Preserve confirmed date-only bookings with **Time not supplied**. Do not invent midnight departures, standard hotel check-in times, or an all-day duration for an event of unknown time.
- Keep date-only values as calendar dates, not timestamps that shift when the display time zone changes. Preserve local time-zone information for timed events; store UTC instants only when resolvable.
- Flight arrival can be on a different day and in a different zone. Hotel stays cross multiple dates. These are core v1 cases.
- Keep each leg of an itinerary, including return legs. Do not merge a hotel, train, and restaurant merely because they share a trip destination or date.
- Match amendments using source links, provider/reference, and the specific booking or leg. A shared reservation code alone must not collapse multiple legs.
- Parse booking details from email bodies and text/HTML messages. Support ordinary single-event calendar attachments. Image, voice, and PDF ticket extraction remain deferred; surface attachment-only bookings for manual review instead of inventing their contents.
- Do not add live transport status, fare monitoring, purchasing, or booking-management actions to v1. The calendar reflects received booking information and reviewed changes.

## 6. Keep iFlight reuse minimal

The existing source was found and inspected at `iFlight`. Use it as a reference for routine Gmail integration only, borrowing small pieces where they clearly save work. Build this app's interpretation layer afresh around a more capable model. Leave iFlight unchanged and do not copy its credentials or production data.

Potentially useful references are the `Gmail client` for pagination, message fetching, decoding, and multipart content handling, and the `OAuth utilities` for the shape of read-only/offline authorization. Any adapted authorization code still needs secure, single-use state tied to the initiating session, PKCE, and secure server-side token storage. Do not copy the existing state handling as-is.

Do not port iFlight's extraction prompt, flight-specific parser, airline sender lists, date-guessing heuristics, or sync architecture. Its narrower model and flight-focused assumptions should not determine how this app understands personal commitments or bookings. Also leave out flight enrichment, maps, carbon calculations, mock data, and missing-time fallbacks.

Use one concise extraction instruction and a clear output schema. The initial choice is Gemini 3.5 Flash Lite for triage and Gemini 3.6 Flash for extraction through OpenRouter. Evaluate these models on representative real email before adding prompt complexity; add targeted clarification only for demonstrated recurring failures. Revisit the model choice using interpretation quality, latency, and measured cost at personal usage levels.

## 7. App, design, and architecture

### Experience

- Edge is the working design: dark slate surfaces, restrained accents, clear typography, and a month-first layout. Rory and Codex refine it together.
- The month has a dismissible selected-day panel, with details beneath it on narrow layouts. Review and Connections remain separate flows.
- Event and review dialogs show booking details, editable fields, and supporting evidence. Booking references are easy to copy; missing times remain explicit.
- Use larger layouts on desktop without turning the app into an administrative dashboard. Support keyboard navigation, readable contrast, reduced motion, and comfortable touch targets.
- Installable Home Screen web app.
- Plan timed-event reminders as event alarms inside the ICS feed; Apple supports subscription alerts, but our feed refresh and alarm behaviour still need actual iPhone tests. Default reminder is 15 minutes before a timed event, editable per event. Date-only bookings get no invented time-based reminder.
- iPhone Web Push is feasible for an installed Home Screen app on iOS 16.4+, after an explicit permission tap. Start with grouped new-suggestion alerts if wanted; event push reminders are an open preference and should not duplicate Calendar alarms. No push delivery is implemented yet. See [iPhone notification findings](docs/iphone-notifications.md). If built, show useful behaviour when notifications are denied. [iPhone web-push support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- Public demo uses fictional bookings and conversations, with no route to personal credentials, messages, or data.

### Technical shape

- **Web app:** Next.js/React on Vercel. The functional `/calendar` route uses Google identity sign-in and an owner-restricted server API bridge; the original fictional design studies remain available at `/designs`. Verify hosted access and keep personal data out of any public showcase.
- **Backend:** the TypeScript/SQLite service runs continuously on the existing Hetzner server, with encrypted storage, hourly Gmail checks and a completed initial import. The official WhatsApp receiving spike is the next integration proof.
- **Calendar feed, pending:** a read-only ICS endpoint at an unguessable path, serving confirmed events with stable UIDs, revision-bumped sequences, correct date-only versus zoned-timed values, and event alarms. Cancelled events leave the feed. This is the planned reminder mechanism and route into the iPhone Calendar app; actual device behaviour still needs verification.
- **Separation:** use a dedicated calendar service account, process, database, and configuration alongside other services. Verify server capacity, service isolation, and HTTPS access as part of deployment; preparing deployment does not establish production readiness.
- **Access:** browser requests pass through authenticated Next.js server routes; the Vercel bridge calls the backend over HTTPS with a server-only credential. The WhatsApp webhook is a separate endpoint authenticated by Meta signatures and disabled until its exact receiver settings are supplied.
- **AI:** OpenRouter's stateless Responses API, using `google/gemini-3.5-flash-lite` for triage and `google/gemini-3.6-flash` for extraction. Requests use concise instructions, bounded context, `store: false`, strict JSON-schema output, and no action tools. Provider routing requires parameter support and sets `data_collection: deny`; if no eligible provider is available, processing fails visibly rather than relaxing these settings. Application validation remains necessary. [Responses API](https://openrouter.ai/docs/api/reference/responses/overview), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- **AI budget:** enforce a configurable **$5 monthly guard**. Reserve a conservative cost allowance before each request and settle against reported cost or configured token rates. Retain the reservation when the network outcome is uncertain. Pause interpretation visibly at the limit while capture and manual calendar operations remain available. Model changes require explicit price configuration.
- **Privacy:** encrypt credentials, source content, calendar records, and proposal evidence; keep keys separate from data and message bodies out of operational logs. Completed source bodies and triage excerpts expire after 14 days, including when Gmail needs reconnecting. Pending/failed captures remain until handled, and proposal evidence remains available for review. OpenRouter's non-collecting provider filter relies on its published provider policies; it is not an independent guarantee of every provider's retention practices.

### Expected cost

Money is not the constraint on this project; time is. Marginal running cost at personal volume:

| Item | One-off | Monthly |
| --- | --- | --- |
| Hetzner, marginal alongside other services | £0 | £0 |
| Pay-as-you-go SIM for the receiving number | ~£10 | ~£1 |
| Meta messaging, user-initiated service window | £0 | £0 today |
| AI, selected triage and extraction models | Live fictional test pair: $0.00507645 | Real volume not yet measured; $5 configured guard |
| ICS feed and native reminders | £0 | £0 |

The live pair is a compatibility check using invented content, not an estimate for a mailbox. Measure actual token volume, extraction frequency, retry cost, and correction effort during the first month of real Gmail traffic before revisiting the $5 guard. Hosting and messaging figures remain planning allowances until their deployed configuration and effective prices are checked.

### Core interfaces

Use shared TypeScript contracts and a versioned API for:

- **Source message:** provider ID, received/source timestamps, provenance, thread/context when available, content, and processing state.
- **Proposal:** proposed create/update/cancel action; target event if any; extracted event/booking details; participation evidence; unresolved fields; supporting source IDs; review state.
- **Event/booking:** confirmed title, category, timed or date-only start/end, relevant zones, location or journey endpoints, optional reservation details, source links, and revision.
- **Connection/job:** credentials reference, Gmail checkpoint, last/next sync, processing progress, retries, and actionable errors.
- **Calendar feed:** the confirmed-event projection served as ICS, with stable UIDs, sequence numbers tied to event revisions, and alarms derived from per-event reminder preferences.
- **Notifications:** user reminder preferences, plus device subscriptions only if grouped-suggestion web push is built.

Confirming a proposal is transactional and idempotent. Stale proposals cannot overwrite newer manual edits. Updating or cancelling an event bumps its revision so the feed's sequence advances and its alarm is rescheduled or withdrawn. Keep domain behaviour independent of the web interface so a later native app can reuse it.

## 8. Build order and verification

Gmail and the calendar foundation are deployed. Rory has now requested a WhatsApp spike and an iPhone push assessment. Prove a no-extra-owned-number receiver next, while retaining the iPhone feed and real-device notification tests as separate deliverables.

1. **Establish the calendar foundation.** Edge, the local personal API, encrypted storage, manual event operations, and reviewed proposals are implemented. Preserve the fictional studies and complete Rory's review of the functional app.
2. **Connect the authorized account.** Google configuration, owner consent, and the expected Gmail profile have been verified through the private deployment.
3. **Verify real Gmail capture and interpretation.** Test the initial scan, hourly/resumable sync, attendance, each booking type, duplicates, amendments, and cancellation review using real or appropriately sanitized examples. The live synthetic model calls do not complete this step.
4. **Spike WhatsApp without another owned number.** Test Meta-provided assets within the timebox. Complete signature, sender restriction and durable-capture checks locally; a real forward and ongoing usability remain mandatory acceptance checks.
5. **Add the iPhone feed and chosen notifications.** Subscribe the actual iPhone and verify date-only/zoned events, additions, edits, cancellations, and alarm behaviour. This remains required for the complete daily-use milestone, but does not block beginning Gmail work.
6. **Complete WhatsApp capture after feasibility passes.** Timebox official receiver onboarding to one evening, then implement durable capture, provenance, follow-up matching, and shared confirmation. Record setup limits; do not substitute an unofficial personal-account connection.
7. **Harden operations.** Restart recovery, OAuth expiration, partial failures, backup/restore, and the AI budget cap. Choose review-alert push independently of event alarms; test the selected reminder channel on the actual phone.
8. **Use privately, then publish the fictional demo.** Judge usefulness by correction effort and missed relevant items.

### Acceptance scenarios

- A forwarded party invitation creates a review item, with attendance unknown until Rory confirms.
- A forwarded “tomorrow” without the original date requests clarification rather than assuming the next day.
- A later WhatsApp change is reflected only after it is forwarded and approved; the UI does not imply access to the original chat.
- A Gmail reply saying “yes, see you then” provides attendance evidence; a refusal does not create a confirmed plan.
- Airline sales, restaurant newsletters, hotel offers, and abandoned checkouts do not masquerade as bookings. A real confirmation containing promotional sections still gets captured.
- Flight, train, restaurant, hotel, appointment, ticket, and generic dated reservation messages produce appropriate proposals, including messages in Gmail's Updates or Promotions category and from unfamiliar senders.
- Return flights remain separate legs; overnight travel handles different dates/time zones; hotel stays preserve check-in/out dates; open train tickets remain date-only when no departure is fixed.
- Repeated booking emails, payment receipts, and reminders do not create duplicates. Hotel/restaurant amendments update the correct booking after review; cancellations remove its future reminders.
- Booking date means the service date, not payment date. Someone else's itinerary stays explicitly uncertain unless Rory chooses to include it.
- Scheduled Gmail checks occur hourly. A new email is picked up at the next successful hourly run; Check now is the only user-triggered extra scan. WhatsApp capture is event-driven and normally prepares a draft within two minutes.
- Webhook replay, duplicate confirmation clicks, restart, expired Gmail history, AI timeout, and partial job failure neither lose accepted input silently nor duplicate confirmed events.
- Build up to 50 labelled examples spanning social plans, confirmed bookings, adverts, ambiguities, and amendments, growing the set from real traffic rather than labelling it all up front. Target at least 90% precision/recall for clear relevant items. Treat that number as a measurement to track, not a gate before personal use; the two properties that *are* gates are zero invented mandatory details and no confirmed events without user approval.
- Confirmed events appear in the iPhone Calendar app through the subscribed feed, with date-only bookings staying date-only across a display time-zone change and a timed event's alarm firing natively. Cancelling an event removes it and its alarm from the feed.
- Confirming from a WhatsApp reply button and confirming the same proposal in the web app produce one event, not two.
- Verify the public demo, the ICS feed path, and unauthenticated requests cannot expose personal records, credentials, or source excerpts.

## 9. Remaining setup inputs and deferred work

Next steps are completing the initial Gmail import and verifying useful bookings through review. The private deployment, Google configuration, account-holder consent and expected Gmail profile have been verified. OpenRouter compatibility passed synthetic checks and the first real batch was interpreted. Meta developer/business setup and a dedicated receiving number remain later prerequisites. Keep credentials in private configuration and verify production eligibility and effective messaging prices before committing to a receiver provider or purchasing a number.

Defaults: Europe/London, Monday-start weeks, 24-hour display, grouped suggestion notifications, and quiet hours of 22:00–08:00 for suggestion alerts. Preserve explicit travel/venue time zones. Begin with an empty calendar populated by manual events and reviewed imports.

Deferred: native iPhone app, two-way external calendar synchronization, task lists, recurring-event series, image/voice/PDF extraction, live transport information, fare monitoring, travel purchases, automatic RSVPs, booking changes with merchants, and access for other real users.

Current decisions, 7 September 2026: the prize remains reduced manual entry, WhatsApp forwarding, and design craft. Rory and Codex are building from Edge, with Gmail deployed, a no-extra-owned-number WhatsApp spike next, and iPhone feed/push work pending device verification. The planned v1 iPhone integration is a one-way feed; eventual WhatsApp and web confirmation use the same reviewed proposal operation.
