# Calendar service API

Local service: `http://127.0.0.1:8787`. All `/v1/*` requests require `Authorization: Bearer CALENDAR_SERVICE_TOKEN`. This is a server-to-server credential: the frontend must authenticate its owner and proxy requests; never expose it to browser JavaScript. No CORS access is enabled. `GET /health` is public and returns `{ "ok": true }`.

JSON errors are `{ "error": { "code": "revision_conflict", "message": "This event has changed. Refresh and review it again." } }`. HTTP 400 = invalid input, 401 = invalid service credential, 404 = missing record, 409 = stale/review conflict, 503 = missing integration configuration. Provider error bodies and credentials are never returned.

## Data

`Event`: `{ id, title, date, time?, endDate?, endTime?, timeZone?, endTimeZone?, kind, location, detail, reference?, reminderMinutes?, source, revision }`. Dates use `YYYY-MM-DD`, times `HH:mm`, time zones IANA names. `kind` is `food | travel | stay | social | appointment | other`. `source` is `Gmail | Manual`. Missing time remains absent. A confirmed event requires a valid title and date. A hotel end date represents checkout; flight arrival may have a different zone/date. Revisions start at 1.

`Proposal`: `{ id, action, targetEventId?, targetRevision?, event, attendance, reason, evidence, unresolvedFields, status, revision, sourceMessageIds, createdAt }`. `action` is `create | update | cancel`. `event` has the editable event fields above, but its date may be absent; it has no id/revision. `attendance` is `confirmed | invited | unknown | declined`. `evidence` is an array of short strings. `status` is `pending | confirmed | dismissed`. Pending proposals never appear in the confirmed events collection. Confirming an invited/unknown proposal is the owner's explicit choice to attend; it does not send an RSVP.

`Connection`: `{ status, email, lastSyncAt, nextSyncAt, pendingMessages, capturedMessages, filteredMessages, failedMessages, processingStatus, error, warning, model, triageModel, monthlySpendUsd, monthlyBudgetUsd, configured }`. Nullable times are ISO strings. `status` is `not_configured | disconnected | connected | syncing | reconnect_required`. `processingStatus` is `idle | processing | paused_missing_key | paused_budget | error`. `error` and `warning` are safe, nullable user-facing strings. `configured` means Google OAuth has been configured, not that a mailbox is connected.

`model` and `triageModel` are configured OpenRouter model ids; current defaults are `google/gemini-3.6-flash` and `google/gemini-3.5-flash-lite`. The service uses only `OPENROUTER_API_KEY`, with a fixed OpenRouter endpoint and `store:false`, strict parameter support, and `data_collection:deny`. Missing OpenRouter credentials yield `paused_missing_key` when captured messages await interpretation. Spending uses reported provider cost when available; it contains no API key or prompt text.

## Routes

| Method / path | Request | Response |
| --- | --- | --- |
| GET `/v1/state` | — | `{ events: Event[], proposals: Proposal[], connection: Connection }`; proposals includes pending only |
| POST `/v1/gmail/connect` | `{ ownerId: string }` | `{ url, state }` |
| POST `/v1/gmail/callback` | `{ ownerId, code, state }` | `{ connected: true }` |
| POST `/v1/gmail/sync` | `{}` or no body | HTTP 202 `{ accepted: true }`; refresh state to see progress |
| GET `/v1/gmail/triage` | — | `{ entries: [{ id, status, decision?, reason?, excerpt?, subject? }] }`; up to 50 recent audited decisions |
| POST `/v1/gmail/retry-processing` | `{}` or no body | HTTP 202 `{ accepted: true }`; retries failed captured messages without scanning Gmail |
| POST `/v1/gmail/disconnect` | `{}` or no body | `{ disconnected: true, warning?: string }`; removes local credentials and queued source content, preserves calendar/proposals |
| POST `/v1/proposals/:id/confirm` | `{ event?: Partial<EventFields>, expectedRevision?: number }` | `{ proposal: Proposal, event: Event \| null }`; repeated successful confirmation returns the same result |
| POST `/v1/proposals/:id/dismiss` | `{}` or no body | `{ proposal: Proposal }`; repeated dismissal is harmless |
| POST `/v1/events` | `EventFields` (no id/revision; source set to Manual) | HTTP 201 `{ event: Event }` |
| PATCH `/v1/events/:id` | `{ event: Partial<EventFields>, expectedRevision: number }` | `{ event: Event }` |
| DELETE `/v1/events/:id` | `{ expectedRevision: number }` | `{ deleted: true }` |

`EventFields` = title/date/time/endDate/endTime/timeZone/endTimeZone/kind/location/detail/reference/reminderMinutes. On edits, `null` clears an optional field; omitted fields stay unchanged. Required fields cannot be cleared. Confirm may provide missing/corrected fields, but never authorizes a stale change: update/cancel must still match the proposal's original `targetRevision`. Optional `expectedRevision` is an additional assertion against that target event; it does not bypass stale protection. Create confirmation ignores no unresolved facts: date/title must be resolved, while a missing time is valid and remains missing.

The OAuth redirect URI is the frontend's `/api/calendar/gmail/callback` (local default `http://localhost:3000/api/calendar/gmail/callback`). The frontend must store returned state in a Secure/HttpOnly/SameSite=Lax cookie (Secure except localhost), compare it on return, and proxy code/state with the authenticated owner's stable id. The backend additionally consumes a 10-minute single-use state bound to that owner and its PKCE verifier. Gmail requests only `gmail.readonly`; `/profile` must match configured `GMAIL_ALLOWED_EMAIL`. No tokens are returned to the frontend. A successful connection queues an initial 30-day scan.

New scheduled Gmail checks occur hourly. A successful partial import continues its saved scan automatically, with an import-in-progress `warning`, paced at one Gmail request per second by default. A failed capture preserves its checkpoint and exposes a safe `error`; it waits for the next hourly or manual check after bounded provider retries. Source processing is a separate durable queue: paused AI processing does not discard fetched messages or stop a successful import from continuing. Fresh captures have priority; failures back off and stop retrying automatically after three attempts, remaining visible in `failedMessages` for an explicit retry. Eligible processing batches drain independently of Gmail polling. Manual Check now is asynchronous; concurrent checks are coalesced, including checks requested during interpretation. No live inbox or model quality is implied by the synthetic test suite.


## WhatsApp receiver spike

The official Cloud API receiver is disabled unless all four optional settings are present: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_OWNER_SENDER_ID`, and `WHATSAPP_PHONE_NUMBER_ID`. The verify token must be a separate random value of at least 32 characters. The sender ID must match incoming `messages[].from` exactly (normally international digits without `+`); the phone-number ID is Meta's receiving-number identifier. Empty or incomplete configuration keeps the webhook disabled. No access token or additional SDK is used.

| Method / path | Authentication | Result |
| --- | --- | --- |
| GET `/webhooks/whatsapp` | Matching `hub.verify_token`, `hub.mode=subscribe` | Echoes the exact `hub.challenge` as plain text; otherwise 403. Disabled endpoint returns 404. |
| POST `/webhooks/whatsapp` | `X-Hub-Signature-256`, HMAC-SHA256 over the exact raw body using the app secret | Returns 200 `{ received: true }` only after accepted inbound items commit durably. |
| GET `/v1/whatsapp/status` | Existing service Bearer token | `{ configured, capturedMessages, unsupportedMessages, forwardedMessages, frequentlyForwardedMessages, lastReceivedAt, inboxLimit, processingEnabled:false, repliesEnabled:false }`; no message text, sender IDs, or secrets. |
| GET `/v1/whatsapp/inbox` | Existing service Bearer token | `{ configured, total, items }`; at most 50 recent spike items. No frontend route is added yet. |

Only messages matching both the configured sender and receiving number are retained. Other senders/receivers and status notifications are acknowledged without retaining content. Each item has explicit `source: WhatsApp` and `channel: whatsapp_cloud_api` provenance, separate from the Gmail processing queue. Message IDs, text, context, and media metadata are encrypted with the existing record-bound store; message IDs are hashed for the record key. Repeated deliveries preserve the first captured item and do not increase counts, including after restart.

Text is captured up to 16 KiB. Forwarded/frequently-forwarded flags and reply IDs are retained when supplied. Original sender and original message time remain explicitly unknown; the incoming provider timestamp describes the delivery to this receiver and is not a booking date. Unsupported types and oversized/invalid text become `unsupported` inbox records. Media is never downloaded; only bounded metadata such as a filename, MIME type, and media ID may be retained.

Bounds: 128 KiB per HTTP body, 50 messages per notification, and 1,000 items in this spike inbox. A full inbox returns 503 without partially accepting a batch. Stored spike items remain pending for the later interpretation milestone. This spike sends no WhatsApp messages, marks nothing read, invokes no model, and creates no calendar proposals or events. It requires no phone-number purchase in code; Meta onboarding and test-number suitability remain separate checks.

The protocol was checked against [Meta's official webhook samples](https://github.com/fbsamples/whatsapp-api-examples/tree/main/receive-webhook-js) and [signature example](https://github.com/fbsamples/whatsapp-api-examples/tree/main/signature-validation-with-webhooks-payloads). Main Meta documentation requests were rate-limited during implementation. Thirteen synthetic tests cover verification, byte-exact signatures, replays, sender/receiver isolation, encrypted persistence, restarts, unsupported inputs, capacity, durable-write failures, and the unchanged authentication of `/v1` routes. No real Meta webhook has been received in this implementation test.


## Calendar feed and review alerts

All settings routes retain the existing service credential and owner/origin-protected frontend proxy. No settings operation enables another integration.

| Method / path | Request | Response |
| --- | --- | --- |
| GET `/v1/calendar/feed` | — | `{configured, enabled, url, webcalUrl, updatedAt, blockedEvents:[{id,reason}]}` |
| POST `/v1/calendar/feed/enable` | `{}` | Feed settings; creates one encrypted private grant, idempotent while enabled |
| POST `/v1/calendar/feed/rotate` | `{}` | Feed settings with a new URL; old URL immediately invalid |
| DELETE `/v1/calendar/feed` | `{}` | Feed settings, revoked |
| GET/HEAD `/calendar/feed/:token.ics` | Private token in path | Public bearer-link exception, `text/calendar`, no-store; uniform 404 for invalid/disabled/revoked tokens |
| GET `/v1/notifications` | — | `{configured, publicKey, enabled, subscriptionCount, subscriptionIds, delivery, quietHours}` |
| POST `/v1/notifications` | `{subscription: PushSubscriptionJSON}` | Notification settings; opt this device in, baseline existing suggestions |
| DELETE `/v1/notifications` | `{endpoint?:string}` | Notification settings; omitted endpoint disables all devices |

`subscriptionIds` contains SHA-256 hashes of endpoints so the browser can identify its own subscription without exposing endpoint URLs. `delivery` contains `{state,lastSentAt,lastErrorCode,nextAttemptAt}` with safe codes only. No send-test or arbitrary-message endpoint is exposed. Push configuration requires a complete, valid VAPID triplet. Subscription writes are bounded to 4 KiB and five devices.

`reminderMinutes` is an integer from 0 to 10080, or null to disable. Omitted means 15 minutes for timed events; date-only events never receive time-based alarms. See [delivery semantics and acceptance limits](../docs/calendar-delivery.md).
