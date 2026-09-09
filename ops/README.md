# Backend operations

The backend runs as an isolated service with its own system account, runtime, configuration and persistent SQLite database. The public repository contains reusable scripts and examples. Machine addresses, SSH identities, release records and original owner-specific runbooks stay in ignored local files.

## Local deployment settings

Copy `deployment.env.example` to `ops/local/deployment.env` and set the SSH target, identity path and HTTPS backend origin. Explicit environment values take precedence over these local defaults. The existing operator's values are retained privately. Never copy a private key into this project.

The SSH helper requires an existing trusted host key and uses non-interactive authentication. Check the expected host independently before adding it to your known-hosts file.

For a slow operator connection, `CALENDAR_SSH_CONNECT_TIMEOUT` can override the eight-second connection timeout (1–60 seconds). An optional `CALENDAR_SSH_CONTROL_PATH` reuses an operator-created SSH control socket across deployment steps; omit it for ordinary connections. Neither option changes remote SSH settings or bypasses host-key verification.

The helper uses `IPQoS=none` to avoid connection stalls on some operator networks. If local HTTPS probes stall during TLS 1.3 negotiation while the hosted app remains reachable, run with `CALENDAR_PROBE_TLS12=true` to use verified TLS 1.2 for the deployment checks. This does not change the server's TLS configuration or disable certificate validation.

## Server layout

| Purpose | Path |
| --- | --- |
| Immutable releases | `/opt/my-calendar/releases/` |
| Active release symlink | `/opt/my-calendar/current` |
| Pinned Node runtime | `/opt/my-calendar/runtime/node` |
| Production configuration | `/etc/my-calendar/calendar.env` |
| Persistent database | `/var/lib/my-calendar/calendar.sqlite` |
| Backend listener | `127.0.0.1:8100` |

`prepare-hetzner.sh` prepares the calendar account, directories and pinned runtime on an Ubuntu x86_64 host. Review it for your machine before running it as root. It does not start an application service. `my-calendar.service.example` is the calendar's systemd unit.

HTTPS provisioning is installation-specific. Configure a trusted certificate and proxy to the loopback listener before exposing the application. The deployment helper expects a `my-calendar-tls.service` proxy and checks that an existing `caddy.service` remains running. On a shared host, set `CALENDAR_PROTECTED_SERVICE` to the additional service whose process must remain unchanged; the default is `caddy.service`. Private TLS configuration, public information pages and the original one-off installer are deliberately excluded from this repository.

## Deploy an existing backend

Run the backend tests and typecheck, then freeze its source before deployment. A deployment changes the remote service, so inspect the target and release before running it.

```bash
bash ops/deploy-backend.sh --preserve-env
```

This uploads an immutable source release, verifies its checksums, installs production dependencies, switches the active symlink and restarts only the calendar backend. It verifies trusted HTTPS health and rejection of unauthenticated private API requests. It also checks the persistent database identity, configuration bytes and protected service processes remain unchanged. Release records are written to ignored `ops/releases/`.

For initial configuration or an intentional credential change, place the complete production environment in ignored `server/.env.production`, protect it with mode `0600`, and run the helper without `--preserve-env`. Credentials travel over SSH stdin into `/etc/my-calendar/calendar.env`, owned by `root:my-calendar` with mode `0640`. The service requires an explicit `GMAIL_ALLOWED_EMAIL`; an address is never inferred from public source.

Both deployment modes require the prepared server layout and TLS service. Neither mode requests a Gmail scan. Do not overwrite an existing database or encryption key during a deployment. Back up the database and encryption key securely and separately; a release rollback does not restore deleted data.

## Private operator notes

Original installation notes and the existing deployment defaults are preserved under ignored `ops/local/`. The live TLS config and one-off installation assets also remain local. These files can contain account identities and infrastructure details and must never be staged for publication. Follow [Google setup](google-setup.md) and [frontend integration](frontend.md) for the reusable configuration steps.

## Latest integration check

On 7 September 2026 the initial Gmail import was confirmed complete, a history checkpoint was present, and scheduled capture was active. Both calendar services were running without automatic restarts and storage capacity was healthy. Detailed counts and account-specific diagnostics are retained only in `ops/local/`.

On 8 September the WhatsApp test receiver was enabled with an owner/receiving-number restriction. Meta verified its callback and active message subscriptions. Correct verification and signed empty delivery return 200; unsigned delivery returns 401. Private status/inbox endpoints require the service credential. Automatic interpretation and replies remain disabled during the real-forward test. The backend suite now also covers the private ICS feed, opt-in review push and isolated backup recovery. One genuine forwarded text was captured after publication and after the temporary setup token expired. Long-term test-number usability, browser-closed receiving and iPhone notification delivery remain unverified. WhatsApp interpretation and calendar entry are not enabled yet.


## Calendar delivery and recovery

The delivery release adds a private subscription origin and a stable VAPID key pair to the existing backend environment. Existing Gmail credentials, encryption key, database path and owner configuration are preserved. The feed remains disabled until Create private link is chosen; push has no subscribed devices until explicit opt-in. [Calendar delivery](../docs/calendar-delivery.md) documents the public bearer-link boundary and device limitations.

[Backup recovery](../docs/backup-recovery.md) describes consistent online snapshots, private off-host copies and isolated integrity/decryption verification. Database verification has passed on a real snapshot; it does not establish complete provider recovery or an independent key backup.

A post-deployment transient caused several frontend reads to fail. Fresh authenticated checks recovered without a configuration change. The proxy now retries failed reads once within a bounded deadline and logs only fixed error categories; writes are never replayed. TLS verification and protocol settings remain unchanged. Treat repeated timeouts as an operational issue to investigate; this check is not a long-term uptime guarantee.

A later authenticated Vercel state request still exhausted both read deadlines. Direct backend reads remained fast (15–26 ms locally; 283–524 ms through public HTTPS), with no corresponding restart, OOM or Caddy error. Recent host memory/I/O pressure leaves a transient stall possible; the cause is unproven. Continue investigating connection establishment separately from request deadlines before calling this resolved. The model-processing fixes were subsequently deployed with the existing environment and database identity preserved.

On 8 September, recurring frontend timeouts coincided with substantial shared-host memory pressure from another workload. The calendar API and its dedicated TLS proxy now have best-effort memory protection in a separate calendar slice; unrelated services and saved data are preserved. The client also coalesces refreshes and makes timeouts and unknown connection state explicit. See [calendar reliability](../docs/calendar-reliability.md) for evidence, installation, verification and rollback. Protection mitigates contention; it does not establish an uptime guarantee or eliminate the shared host's capacity limit.

## WhatsApp interpretation and screenshots — 8 September 2026

The implementation uses the same durable source queue, automatic-addition rules, owner-edit protection and model budget as Gmail. Set `WHATSAPP_PROCESSING_ENABLED=true`, the verified `WHATSAPP_CONTACT_NUMBER`, and a private `WHATSAPP_ACCESS_TOKEN` alongside the four existing receiver settings. The rollout flag defaults off. Enabling it also queues previously captured text exactly once. Disabling it leaves incoming captures stored and Gmail processing active. Do not replace the live environment from an old local copy; merge only these keys and deploy with `--preserve-env`.

JPEG/PNG images are retrieved using fresh Meta media URLs and the private bearer credential. Downloads are limited to 5 MiB and 16 megapixels, restricted to Meta's media host, checked against supplied hashes and never written as image files. The model reads the image, then the normal extractor interprets the encrypted cached text. Missing access causes a retryable failure without blocking text. Once credentials are renewed, use Connections → retry saved messages. Completed message/transcription and raw inbox content is pruned after 14 days; resulting events/proposal evidence and deduplication identity remain. Pending/failed content remains for recovery.

The renewed credential has approximately 60 days of validity, not permanent access. Its actual renewal/expiry timestamps are stored only in ignored setup data. Keep it in private local `.env` files and the protected server environment; never ship it to Vercel client code. Connections exposes receiver activity and screenshot connection problems, never credentials. There are no outgoing WhatsApp messages or RSVPs.

Validation: 150 backend tests and 49 existing web tests passed, including signed queue admission, retries, duplicate forwards, missing-date clarification, explicit reply completion, source retention, media bounds and ICS invitation labels. A fictional hotel screenshot passed two real Gemini 3.6 Flash calls at a combined $0.01198. This does not yet establish real WhatsApp image delivery; that requires a user-forwarded image.

Deployment verification: backend release `20260908T222624Z` is healthy with processing enabled and media access configured. Existing environment values, database identity and proxy process were preserved. Git/Vercel commit `7269cb0` succeeded. The existing real text was interpreted without errors and correctly placed in Needs details because its event year depends on “this year” in a forwarded message with no original timestamp. No event date was guessed. This establishes live text processing and the uncertainty path, not yet a successful real automatic event or image-download acceptance.

## Multiple Gmail inboxes — 9 September 2026

Backend release `20260909T091902Z` and Git/Vercel commit `5ec99b2` support multiple inboxes. The original connection, encrypted credentials, source IDs and history checkpoint remain at their legacy default keys. Additional inboxes use a stable email-derived account ID and namespaced message/thread IDs; no migration or initial re-import of the original inbox is needed. Each inbox has separate encrypted credentials, scan state, consent generation and reconnect status. Disconnect stops the shared worker briefly, removes only the selected inbox's source data/credentials and resumes the remaining work. Model budget and paced Gmail reads are shared; imports run sequentially.

Connections lists individual inboxes and accepts a new Gmail address. The backend binds the requested address to owner-specific, single-use PKCE state and verifies the actual Gmail profile before saving credentials. An existing mailbox accidentally chosen while adding another is rejected without revoking its existing grant. Additional inboxes never change the private calendar's sign-in allowlist. A verified off-host backup preceded deployment. All 159 backend tests and 51 frontend tests passed, as did the production build. Live verification showed the original inbox/checkpoint and 27 saved events retained, with WhatsApp processing active. The second inbox's real Google login/consent is pending; test-user allowlisting may be required if Google keeps the OAuth app in testing.
