# Backend operations

The backend runs as an isolated service with its own system account, runtime, configuration and persistent SQLite database. The public repository contains reusable scripts and examples. Machine addresses, SSH identities, release records and original owner-specific runbooks stay in ignored local files.

## Local deployment settings

Copy `deployment.env.example` to `ops/local/deployment.env` and set the SSH target, identity path and HTTPS backend origin. Explicit environment values take precedence over these local defaults. The existing operator's values are retained privately. Never copy a private key into this project.

The SSH helper requires an existing trusted host key and uses non-interactive authentication. Check the expected host independently before adding it to your known-hosts file.

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

The WhatsApp receiver spike is deployed disabled. Its public webhook returns 404 until all receiver settings are present; private status/inbox endpoints require the service credential. Sixty-six backend tests passed, including thirteen webhook checks. A real Meta forward, long-term test-number usability and iPhone notification delivery remain unverified.
