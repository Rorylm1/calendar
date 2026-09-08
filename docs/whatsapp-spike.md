# WhatsApp forwarding spike

Research checked **7 September 2026**. **A real iPhone → Meta → calendar delivery test is still pending.** Meta’s callback and test-account subscriptions are configured; this document distinguishes setup verification from real phone delivery.

## Objective and decision

Forward a selected WhatsApp commitment to a calendar contact, then add valid dated items automatically. Invitations use the INVITATION: prefix; missing facts go to Needs details. The user does **not** want another owned phone number or SIM. The first experiment therefore uses the **Meta-provided test receiver**, if available in the account's onboarding flow. Do not purchase or register another number, migrate the personal WhatsApp account, or treat test assets as a guaranteed permanent service.

Cloud API is a business messaging interface requiring a Meta business portfolio, WhatsApp Business Account (WABA), and receiving business phone number. It is not an API for reading a normal personal WhatsApp account or its “message yourself” chat. Meta's test setup is the candidate way to try the integration without supplying another receiving number. Current test-number availability and restrictions must be recorded from the dashboard; the developer getting-started page could not be fetched during this research. [Meta's Cloud API overview and setup reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), [Meta getting started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started).

## Minimal onboarding experiment

1. In the Meta developer dashboard, add the WhatsApp use case/product and select the appropriate portfolio. Use the supplied test WABA/number. Record any account eligibility requirement before continuing; a personal project is not a reason to invent business details.
2. Add the user's **existing WhatsApp phone** to the test recipient list and complete the verification offered by Meta. Record the displayed recipient limit and any asset expiry. An outbound recipient allowlist does not, by itself, prove inbound forwarding works.
3. Use the dashboard's test message to open the chat on the iPhone, then save its receiving number as the calendar contact. Meta's example sends the `hello_world` template; use the API version offered by the current dashboard, not an old example version. [Meta test-message request](https://www.postman.com/meta/whatsapp-business-platform/request/9php9mt/send-test-message).
4. Configure the callback below, subscribe to the `messages` field, and ensure the app is subscribed to the selected WABA. An app-level webhook alone is not the full subscription. [Meta WABA subscription reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-198b362a-c39e-48fc-a446-20fe430401e4).
5. From the verified phone, forward a fictional dated invitation using WhatsApp's normal Forward action. Check that it appears exactly once in the protected spike inbox. Repeat with a normal newly typed message and a message containing only “tomorrow”. Do not use private third-party messages for the first test.

Dashboard user access tokens expire after 24 hours. Meta also supports system-user tokens lasting up to 60 days or indefinitely; the actual test WABA's assignability must be checked. A temporary token expiring does not itself prove an existing inbound webhook stops, but unattended receiving and any later outbound/API calls must be tested separately. No indefinite test-number availability has been established. [Meta access-token reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Receiver contract

The backend spike was deployed disabled on 7 September 2026 after 66 backend tests passed. On 8 September it was enabled for the verified owner and Meta test receiving number, and Meta verified the callback. Real phone delivery remains pending. The contract is:

- Public callback (replace the example origin with the private `CALENDAR_BACKEND_ORIGIN`): `https://your-calendar-service.example/webhooks/whatsapp`. GET verification compares `hub.verify_token` with the private configured value before returning `hub.challenge` for a subscription request.
- POST requests require `X-Hub-Signature-256`, checked as HMAC-SHA256 over the **raw body** using the Meta app secret. The verification token and app secret serve different purposes.
- Private settings are `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_OWNER_SENDER_ID`, and `WHATSAPP_PHONE_NUMBER_ID`. Set them privately; no real values belong in this document, source control, URLs, or browser code.
- Only the configured receiving phone and owner sender may create captures. Deduplicate provider message IDs, persist before acknowledging success, and ignore delivery/read status updates as capture sources.
- Review captured text through the bearer-protected `/v1/whatsapp/inbox`. The Meta callback uses its signature contract; it must not require the calendar browser's bearer token. All ordinary calendar API authentication remains in place.

Meta documents HTTPS callbacks and WABA subscriptions in its [webhook reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup?entity=request-13382743-fa2e2584-cfcf-4ef2-95c3-5f586569ac4f). The allowlist, durable inbox and deduplication above are this application's requirements.

## What a forward tells us

Meta's message object identifies the person who sends the message to the business and the timestamp of that send. Its context object can mark a forward. `context.from` and `context.id` describe reply context; they must not be treated as the original author and original ID of a forwarded invitation. [Meta message fields](https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object), [Meta context fields](https://www.postman.com/meta/whatsapp-business-platform/folder/hysdhqs/context-object).

Consequently, do not assume the original author, original timestamp, group name, surrounding conversation or later edits are available. “Tomorrow” in an old forwarded message needs a date clarification. Forwarding shows interest in capturing something, not confirmed attendance. Keep invitations provisional until attendance is established. Explicit restaurant, hotel, flight, train and other dated booking confirmations are useful inputs. Screenshots, PDFs, voice notes and automatic interpretation are follow-on work; text capture is the first acceptance test.

## Cost and production decision

As checked on 7 September, Meta's public pricing overview bills **delivered business-to-user messages**, with rates varying by recipient market and category. An incoming forward is not such an outbound delivery. The overview says service replies during the rolling 24-hour customer-service window, and utility replies within that window, are free. Outbound templates can incur charges; do not plan delayed WhatsApp reminders or promise replies are free indefinitely. Hosting and model usage remain separate costs. Recheck the effective-dated rate card before enabling ongoing replies: the detailed developer pricing page was inaccessible during this research. [Meta pricing overview](https://whatsappbusiness.com/products/platform-pricing/).

Do not retain the old blanket “a fresh SIM is required” assumption. Meta has a separate onboarding route for existing WhatsApp Business App users, commonly called Coexistence. Its current account/country/provider eligibility could not be verified from the primary page here; it is **not** a validated solution for this user's normal personal WhatsApp account. Do not migrate an existing account to try it. Production number ownership, verification, business requirements and any provider fees remain a later feasibility decision, not an agreed setup step. [Meta Business App onboarding reference — eligibility check pending](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/).

If the test receiver proves unsuitable for ongoing use under the no-extra-number constraint, prefer a capture form with pasted text. An iPhone Shortcut could reduce those steps after a device test. WhatsApp's documented iPhone Share Extension concerns sharing **into WhatsApp**; it does not establish that selected text can be shared out to our app or a Shortcut. [WhatsApp's iPhone integration guide](https://faq.whatsapp.com/425247423114725/?cms_platform=iphone).

## Acceptance record — pending

- [x] Meta offers a test receiver without another owned number or a purchase.
- [ ] The existing personal phone verifies and forwards text successfully.
- [ ] Genuine signed delivery appears once in the private inbox; an unapproved sender cannot create a capture.
- [ ] Actual forward/reply metadata is recorded without assuming missing context.
- [ ] Receiving still works with the app browser closed and after the dashboard token expires; any required long-lived asset/token access is demonstrated.
- [ ] The user finds forwarding convenient enough to keep. If not, choose the no-number capture alternative before expanding WhatsApp work.

Source limitation: Meta's developer pages repeatedly returned HTTP 429. Accessible Meta-maintained Postman references and the official WhatsApp pricing/help pages support the facts above; unverified dashboard, Coexistence and long-term test-asset behavior remain explicitly pending. No real message, credential or business identity has been stored in this document.

## Account onboarding progress — 8 September 2026

Rory completed developer registration, created the Rory Calendar business portfolio and app, and accepted the WhatsApp setup terms. The dashboard provisioned a Meta test phone number and displayed a five-recipient test limit. No owned receiving number or SIM was purchased or registered. The existing personal phone completed recipient verification and is selected in the test dashboard. Rory approved test-account access and the final Business Tools agreement. A temporary access token was generated for the current test account only. The dashboard reported that the one approved sample message was sent; handset delivery has not yet been confirmed. Rory completed the password re-entry check. The signing secret and receiver settings were saved in ignored server `.env` files with owner-only local permissions; the temporary access token stays local. Only the four receiving settings were added to the protected live environment, with a private rollback copy. The calendar service was restarted, its database identity and existing environment values were preserved, and the shared proxy was unchanged. Meta verified the callback and reports an active `messages` subscription (v26.0), with Rory Calendar subscribed to the test WABA alongside Meta’s existing dashboard app. The first real forward remains pending. Test-number provisioning alone does not establish inbound delivery or permanent availability.

A bounded server check found the calendar service active, the receiver correctly disabled (HTTP 404), and zero current memory-pressure averages. The normal calendar and unrelated workloads were unchanged. Account identifiers and the intended sender restriction are saved only in ignored local operations data.

A subsequent bounded check found the calendar service active at approximately 160 MiB, with zero current memory-pressure averages. The TradeR paper-session timer was observed active again; this WhatsApp setup did not change it. Do not assume the historical TradeR pause still describes current server state.

Receiver acceptance checks on 8 September: public verification returns the exact challenge (200), a correctly signed empty envelope returns 200 without adding records, and an unsigned envelope returns 401. Authenticated status reports the receiver configured, with automatic interpretation and replies disabled. The dashboard also warns that unpublished apps do not receive production data, including from admins/testers; whether this restricts the provided test assets must be resolved by the real-forward check. The app was not published and no payment or owned-number setup was performed.

## Delivery diagnosis — 8 September 2026

Rory reported sending the requested real forward. The private receiver still reported zero captures after that attempt. Meta’s dashboard **Send to server** test for the `messages` v26.0 field reported success, proving that Meta can reach the endpoint with its signature; its fictional sender/receiving-number sample is correctly excluded from the owner inbox. This is not evidence of successful phone forwarding.

The dashboard explicitly says unpublished apps receive dashboard tests only and do not receive production data, including from admins, developers, or testers. The Publish checklist listed a missing privacy-policy URL. The existing public privacy page was updated with accurate WhatsApp test capture, metadata, retention and current controls; build, typecheck and all 49 frontend tests passed, and Vercel deployed commit `11d9491` successfully. The published privacy content was verified anonymously.

Meta’s privacy and deletion-information fields are being set to that public page; the unrelated default Terms of Service URL is being cleared. These form changes are **not yet saved or verified**. Native browser access stopped because the Mac locked. On resumption, inspect the exact field values again before saving: the user’s concurrent clipboard use changed one paste destination during setup. Do not assume the unsaved data-deletion field is correct. The Meta app remains unpublished; review its remaining requirements before making any publication decision. No additional WhatsApp message was sent by the app.
