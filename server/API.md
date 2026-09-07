# Calendar service API

Local service: `http://127.0.0.1:8787`. All `/v1/*` requests require `Authorization: Bearer CALENDAR_SERVICE_TOKEN`. This is a server-to-server credential: the frontend must authenticate its owner and proxy requests; never expose it to browser JavaScript. No CORS access is enabled. `GET /health` is public and returns `{ "ok": true }`.

JSON errors are `{ "error": { "code": "revision_conflict", "message": "This event has changed. Refresh and review it again." } }`. HTTP 400 = invalid input, 401 = invalid service credential, 404 = missing record, 409 = stale/review conflict, 503 = missing integration configuration. Provider error bodies and credentials are never returned.

## Data

`Event`: `{ id, title, date, time?, endDate?, endTime?, timeZone?, endTimeZone?, kind, location, detail, reference?, source, revision }`. Dates use `YYYY-MM-DD`, times `HH:mm`, time zones IANA names. `kind` is `food | travel | stay | social | appointment | other`. `source` is `Gmail | Manual`. Missing time remains absent. A confirmed event requires a valid title and date. A hotel end date represents checkout; flight arrival may have a different zone/date. Revisions start at 1.

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

`EventFields` = title/date/time/endDate/endTime/timeZone/endTimeZone/kind/location/detail/reference. On edits, `null` clears an optional field; omitted fields stay unchanged. Required fields cannot be cleared. Confirm may provide missing/corrected fields, but never authorizes a stale change: update/cancel must still match the proposal's original `targetRevision`. Optional `expectedRevision` is an additional assertion against that target event; it does not bypass stale protection. Create confirmation ignores no unresolved facts: date/title must be resolved, while a missing time is valid and remains missing.

The OAuth redirect URI is the frontend's `/api/calendar/gmail/callback` (local default `http://localhost:3000/api/calendar/gmail/callback`). The frontend must store returned state in a Secure/HttpOnly/SameSite=Lax cookie (Secure except localhost), compare it on return, and proxy code/state with the authenticated owner's stable id. The backend additionally consumes a 10-minute single-use state bound to that owner and its PKCE verifier. Gmail requests only `gmail.readonly`; `/profile` must match configured `GMAIL_ALLOWED_EMAIL`. No tokens are returned to the frontend. A successful connection queues an initial 30-day scan.

New scheduled Gmail checks occur hourly. A successful partial import continues its saved scan automatically, with an import-in-progress `warning`, paced at one Gmail request per second by default. A failed capture preserves its checkpoint and exposes a safe `error`; it waits for the next hourly or manual check after bounded provider retries. Source processing is a separate durable queue: paused AI processing does not discard fetched messages or stop a successful import from continuing. Fresh captures have priority; failures back off and stop retrying automatically after three attempts, remaining visible in `failedMessages` for an explicit retry. Eligible processing batches drain independently of Gmail polling. Manual Check now is asynchronous; concurrent checks are coalesced, including checks requested during interpretation. No live inbox or model quality is implied by the synthetic test suite.
