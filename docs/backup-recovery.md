# Backup and recovery

## What this protects

The backup utilities capture a consistent SQLite snapshot while the calendar service remains running. They use Python's SQLite **online backup API**, opening the source read-only. They do not copy the live `.sqlite` file without its WAL, start application workers, or construct `Store` against the live database. That constructor performs migrations and resets processing states, so it is unsuitable for a read-only backup check.

Existing AES-256-GCM envelopes remain encrypted in the snapshot. SQLite metadata, identifiers and usage metadata are not an encrypted filesystem image. Treat the whole backup as private: directories are owner-only (`0700`), and database, manifest and verification files are owner-only (`0600`). Nothing under `ops/local/` belongs in public Git or a deployment artifact.

## Create and check a remote backup

Prerequisites: the existing SSH helper configuration, Python with SQLite backup support on both machines, local Node 24, and a separate private environment file containing the production database's matching `CALENDAR_ENCRYPTION_KEY`.

From the project directory:

```bash
bash ops/backup-remote.sh
```

The wrapper streams the backup utility over the existing trusted SSH connection. It creates a private snapshot under the server's calendar backup directory, downloads just the database and manifest into ignored `ops/local/backups/`, then verifies a disposable local copy. A sanitized verification report goes to `ops/local/backup-reports/`. Console output contains success/failure, not decrypted records or mailbox counts. The report records counts without titles, addresses, source text, credentials or encryption keys.

Optional environment settings:

| Variable | Purpose |
| --- | --- |
| `CALENDAR_REMOTE_DB_PATH` | Existing source database; defaults to the calendar service's standard persistent database path. |
| `CALENDAR_REMOTE_BACKUP_ROOT` | Private server backup directory; defaults to `/var/backups/my-calendar`. |
| `CALENDAR_BACKUP_KEY_ENV_FILE` | Separate private key environment; defaults to ignored `server/.env.production`. |
| `CALENDAR_BACKUP_NODE` | Local Node 24 executable if `node` is not the intended runtime. |

The SSH target and identity remain in the existing ignored deployment configuration. This command creates backup files only. It does not install a timer, replace the production database, update credentials, restart the service, scan Gmail or call a model/provider.

## Run the pieces separately

On the machine that owns the database, use an existing source and a private destination:

```bash
python3 ops/backup-calendar.py \
  --source /path/to/existing/calendar.sqlite \
  --destination /path/to/private/calendar-backups
```

Each completed bundle contains `calendar.sqlite` and `manifest.json`. Creation is atomic, includes an integrity check, records a SHA-256 checksum, and leaves no required WAL sidecar. Failed captures do not become completed bundles.

To recheck an existing bundle, choose a new report filename inside a private directory. The environment file must contain the **original matching key**, not a newly generated replacement:

```bash
env -u CALENDAR_ENCRYPTION_KEY node --env-file=server/.env.production \
  ops/verify-backup.mjs \
  --backup ops/local/backups/CHOSEN_BACKUP_ID \
  --report ops/local/backup-reports/new-verification.json
```

Verification copies the completed snapshot to a private temporary directory, opens only that copy read-only, checks SQLite integrity and foreign keys, and authenticates/decrypts every encrypted record, source body, source audit and OAuth-state payload in memory. This covers new record buckets such as WhatsApp captures, calendar-feed state and push state automatically. Unknown tables fail closed until verification coverage is updated. Wrong keys, modified payloads, mismatched checksums and overexposed file permissions fail the check. An empty database cannot establish that a key matches, so it does not pass full decryptability verification. Temporary copies are removed on success and handled failure; interruption by a hard process kill may require removal of the private temporary directory.

No plaintext is written. The original backup is checked for changes, and an existing report is never overwritten. The verifier cannot tell whether a Google token is still valid, whether a device will receive a push, or whether every restored application workflow works.

## Retention and the separate key

Successful backup runs prune this utility's completed bundles older than **14 days**, while preserving at least the **three newest**. The minimum can retain copies longer than 14 days when backups are infrequent. Unrelated directories and symlinks are ignored. `--keep-days` and `--keep-minimum` configure this policy; `--prune-only` applies it without making a new snapshot. Local and server copies use the same defaults. Backup copies can outlive records deleted from the live app.

There is currently **no automatic backup schedule**. The recovery point is the latest successful snapshot, not an implied daily guarantee. The remote wrapper provides an off-host copy on the operator's machine, but loss of both machines still requires another independently protected backup location.

The encryption key is deliberately absent from every bundle. Preserve the matching key separately in secure recovery storage, with a record of which snapshots it unlocks. Keep deployment credentials/configuration and the matching application source release recoverable separately too. A local environment file proving decryptability is **not** evidence that an independent recovery copy of the key exists. Manifests and reports therefore leave separate key-backup verification false. Never rotate away or discard an old key while retained backups still require it.

## Actual production recovery — not performed

Production replacement requires an explicit maintenance decision. Before any replacement:

1. Select a snapshot and recover its matching key; rerun isolated verification. Preserve the current database and configuration independently before proceeding.
2. Stop the calendar service and prevent provider work while preparing recovery. Keep the old database and its sidecars together; never overlay a snapshot onto a running WAL database or retain unrelated old WAL files beside a replacement.
3. Restore into a separate staging location with the correct account ownership and permissions. Use the matching source release and inspect compatibility before enabling workers. Verify application reads and representative calendar operations in isolation.
4. Review the snapshot's pending work, notification jobs, Gmail checkpoint and cost ledger against the time since backup. A restore can replay pending operations, omit newer records, revive old access tokens/feed links, or understate spend incurred after the snapshot. Resolve these before resuming external work; reconnect revoked Google access if needed.
5. Only after the staged recovery is accepted, switch the production database during maintenance, start one service instance, and verify authenticated access and persistence. Keep the pre-recovery state available until recovery is accepted.

The current rehearsal proves snapshot integrity and decryptability in isolated storage. It does **not** prove a full production restore, provider reconnection, a recovery-time objective, or an independently escrowed key. No live data replacement or service interruption is part of these utilities.

## Verification evidence

`server/test/backup-recovery.test.ts` uses fictional data and temporary databases. Its six checks cover committed WAL capture without live state changes; all encrypted storage classes; wrong keys; checksum and payload tampering; retention boundaries and unrelated paths; and missing sources/private permissions. Run with:

```bash
cd server
node --import tsx --test test/backup-recovery.test.ts
```

Actual backup identifiers, record counts and verification times belong only in ignored `ops/local/backup-reports/`. Public documentation records capabilities and limitations, not mailbox contents or infrastructure identities.
