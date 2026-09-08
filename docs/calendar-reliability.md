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
