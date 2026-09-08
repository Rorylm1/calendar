# Calendar loading and shared-host reliability

On 8 September 2026, production calendar reads intermittently exhausted both ten-second proxy attempts. The small shared host simultaneously showed heavy memory and I/O pressure: another workload used roughly three quarters of RAM, no swap was available, and five-minute full memory-stall pressure reached approximately 27%. Both calendar services remained running; their own memory usage was modest. Earlier incidents also included stalled loopback connections and SSH handshakes. These observations support host contention as a cause of intermittent connection delays, rather than a persistent calendar query problem or a demonstrated TLS-version defect.

The client now coalesces focus/poll refreshes so later requests cannot continually supersede a slow successful read. A refresh after a mutation waits for an older read, then fetches a new snapshot. A thirty-second client deadline includes receiving the body, aborts the request, and produces a retryable message. Writes are never replayed. Unknown connection and review state is displayed as loading or unavailable, rather than disconnected or empty. Subscription and notification settings load independently.

The server proxy still retries reads once and never retries writes. Body failures are included in read retries, and fixed diagnostics now distinguish connection timeouts from request deadlines and record whether headers or the body were pending. Logs contain only operation categories, attempt number, phase and elapsed milliseconds—no URLs, account identifiers, source content or credentials.

## Calendar-only memory protection

Only the API and its dedicated HTTPS proxy use a top-level `calendar.slice`. The slice has `MemoryLow=320M`; the API has 256 MiB and the HTTPS proxy 64 MiB of best-effort protection. This protects their existing serving footprint from memory reclaim by competing jobs, without allocating that amount immediately or changing their existing maximum-memory/CPU limits. The parent slice is required because protection is bounded by ancestors. See the [Linux cgroup memory protection documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files).

This is a mitigation for shared-host contention, not a capacity or uptime guarantee. Best-effort protection can still be reclaimed if no unprotected memory is available. Unrelated processes, global swap, TLS versions, provider settings and database contents are not changed. A consistently overloaded host ultimately needs workload scheduling or a separate capacity decision.

## Install and verify

Copy these reviewed files together into a private temporary directory on the existing calendar host:

- `ops/install-calendar-resources.py`
- `ops/calendar.slice.example`
- `ops/calendar-api-memory.conf.example`
- `ops/calendar-tls-memory.conf.example`

Run `sudo python3 install-calendar-resources.py` from that directory. The installer refuses symlinks, unexpected ownership/modes, and existing files with different contents. It creates only the dedicated slice and `30-calendar-memory.conf` drop-ins for the two calendar services. A first application restarts those two services to move them to the slice. Repeating the same install is a no-op with no restart.

The installer checks the effective cgroup protection, active service state, persistent database identity, environment checksum, and unchanged unrelated proxy process/configuration. Checks emit booleans only. Existing drop-ins survive the normal backend deployment script and reboot. It does not instantiate the application Store for inspection or replace data, tokens, encryption keys, feed links or push preferences.

After installation, verify authenticated state reads through the production frontend as well as local backend latency. Compare current host memory pressure with the protected services' pressure, ideally during an existing competing workload. Keep detailed diagnostics under ignored `ops/local/`; a few fast reads on an otherwise recovered host do not establish that contention is solved.

## Rollback

Using the same reviewed source files, run `sudo python3 install-calendar-resources.py --remove`. It removes only byte-identical files owned by this setup, reloads systemd and restarts only the two calendar services into their original system slice. A failed application attempts to restore the previous files and service placement automatically. Never use a broad `systemctl revert` or restart the unrelated proxy to undo this change.

No production data restore is required for either application or rollback. The separate online backup timer and [backup recovery procedure](backup-recovery.md) remain unchanged.

## Identified recurring workload — 8 September, 09:28 UTC

A fresh host check after recovery showed 652 MiB in use out of 3819 MiB, 3167 MiB available and no swap. Calendar API memory was about 113 MiB and its dedicated HTTPS proxy about 18 MiB. The low-load calendar is small relative to the host.

Kernel logs identify global out-of-memory kills in `rory-trader-settlement.service` at 08:12 and 09:12 UTC and `rory-trader-paper-session.service` at 08:17 UTC. Each killed Python process held roughly 3.2 GiB of anonymous resident memory. Other runs exhausted their five-minute timeouts. Paper sessions run every 15 minutes and settlement every 30 minutes; both have unlimited service memory limits. These repeating jobs explain the recovery/stall cycle much more specifically than the earlier contention hypothesis.

The live TradeR journal is 773,790,841 bytes (about 738 MiB). Its journal loader builds a Python list containing every JSON record. Proposal existence checks call that full loader, while settlement builds the full journal/accounting summary before applying the position limit. Python objects, copied records and data frames can expand substantially beyond the file size. This is a concrete memory-growth mechanism in the inspected code; no heap profile or controlled reproduction has yet established its exact share of peak allocation.

Recommended order: put the research jobs in a shared bounded memory budget, with job-specific failure reporting; replace repeated full-journal loads with indexed incremental reads and a compact open-position projection; then measure peak memory and calendar latency during normal scheduled work. A shared lock can prevent overlap but does not fix a single oversized run. Keep the append-only history as an audit trail without loading it for every operational lookup. Compressed swap is secondary headroom, not a cure for repeatedly rebuilding an ever-growing history. No TradeR job, schedule, trading data, swap setting or server capacity was changed during this investigation.

## Owner decision and mitigation — 8 September, 09:43 UTC

Rory explicitly chose to leave TradeR's automatic jobs paused because the project is rarely used. Both `rory-trader-paper-session.timer` and `rory-trader-settlement.timer` are now disabled and inactive. Their worker services have no running process. The dashboard API, existing shared proxy, calendar API, calendar HTTPS proxy and calendar backup timer remain running or scheduled as before. Data-file identities and credential bytes were verified unchanged; no trading history was deleted.

Each TradeR timer has a `90-owner-paused.conf` drop-in requiring `/etc/rory-trader/automatic-jobs-enabled`, which is intentionally absent. This protects the owner's pause even if the existing deployment script tries to enable a timer. Do not create that marker or re-enable either timer without Rory explicitly choosing to resume, and address the oversized journal reads before doing so. No journal optimization, swap addition or server upgrade is required for the chosen paused state.

After pausing, the host used about 620 MiB with 3199 MiB available. Three authenticated production calendar reads returned 200 (2197, 573 and 538 ms), with Gmail connected, all 23 saved events and eight factual exceptions intact. The latest ten-second memory-stall average was zero. These checks verify recovery and removal of the identified recurring trigger; they are not an unlimited uptime guarantee.

Hetzner bills the allocated server by time with a monthly cap, rather than adding charges for CPU/RAM utilization. Pausing an application therefore does not remove the base server bill. Traffic overages and separately billed products are independent; no account invoice was audited. See [Hetzner billing](https://docs.hetzner.com/cloud/billing/faq/).
