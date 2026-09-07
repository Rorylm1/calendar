#!/usr/bin/env python3
"""Snapshot a live SQLite database through its online backup API, never a WAL copy."""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import time
import uuid

FORMAT = "calendar-online-backup-v1"
NAME = re.compile(r"^calendar-\d{8}T\d{6}Z-[a-f0-9]{8}$")


def private_directory(path):
    if path.is_symlink():
        raise ValueError("Symlink directory")
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.stat().st_uid != os.geteuid():
        raise ValueError("Directory owner")
    path.chmod(0o700)
    return path.resolve()


def sync_file(path):
    with path.open("rb") as handle:
        os.fsync(handle.fileno())


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def file_digest(path):
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def prune(root, days, minimum, now=None):
    """Only delete this utility's completed, private bundles; keep a recovery floor."""
    now = now or datetime.now(timezone.utc)
    candidates = []
    for path in root.iterdir():
        if not NAME.fullmatch(path.name) or path.is_symlink() or not path.is_dir():
            continue
        try:
            if path.stat().st_uid != os.geteuid() or path.stat().st_mode & 0o077:
                continue
            manifest_path = path / "manifest.json"
            if manifest_path.is_symlink():
                continue
            manifest = json.loads(manifest_path.read_text())
            created = datetime.fromisoformat(manifest["createdAt"].replace("Z", "+00:00"))
            if manifest.get("format") != FORMAT or manifest.get("backupId") != path.name or manifest.get("integrity") != "ok" or created.tzinfo is None:
                continue
            candidates.append((created, path))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    candidates.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    removed = 0
    for created, path in candidates[minimum:]:
        if created < now - timedelta(days=days):
            shutil.rmtree(path)
            removed += 1
    sync_directory(root)
    return removed


def snapshot(source, destination, timeout):
    if source.is_symlink() or not source.is_file():
        raise ValueError("Source must be an existing regular database")
    source = source.resolve(strict=True)
    if not stat.S_ISREG(source.stat().st_mode):
        raise ValueError("Invalid source")
    root = private_directory(destination)
    created = datetime.now(timezone.utc)
    backup_id = f"calendar-{created:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
    staging = Path(tempfile.mkdtemp(prefix=".calendar-backup-", dir=root))
    deadline = time.monotonic() + timeout

    def progress(_status, _remaining, _total):
        if time.monotonic() > deadline:
            raise TimeoutError("Backup time limit")

    try:
        database = staging / "calendar.sqlite"
        descriptor = os.open(database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        reader = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=5)
        writer = sqlite3.connect(database)
        try:
            reader.execute("PRAGMA query_only=ON")
            reader.backup(writer, pages=128, progress=progress, sleep=0.05)
            # Only the destination changes journal mode. It becomes a self-contained file.
            writer.execute("PRAGMA journal_mode=DELETE")
            if writer.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("Snapshot integrity")
        finally:
            writer.close()
            reader.close()
        if any(Path(str(database) + suffix).exists() for suffix in ("-wal", "-journal")):
            raise ValueError("Snapshot has sidecars")
        # Some SQLite versions leave an unused SHM index after switching the
        # isolated destination out of WAL. Both connections are closed; no WAL
        # remains. This is not source data and is not part of the snapshot.
        shared_memory = Path(str(database) + "-shm")
        if shared_memory.exists():
            shared_memory.unlink()
        database.chmod(0o600)
        sync_file(database)
        manifest = {
            "format": FORMAT,
            "backupId": backup_id,
            "createdAt": created.isoformat().replace("+00:00", "Z"),
            "databaseFile": "calendar.sqlite",
            "sha256": file_digest(database),
            "bytes": database.stat().st_size,
            "integrity": "ok",
            "method": "sqlite-online-backup-api",
            "encryption": "Existing AES-256-GCM application envelopes; SQLite metadata is not wholly encrypted",
            "requiredKey": {"environmentVariable": "CALENDAR_ENCRYPTION_KEY", "included": False, "separateBackupRequired": True, "separateCopyVerified": False},
            "restoreVerification": "pending",
        }
        manifest_path = staging / "manifest.json"
        with manifest_path.open("x") as handle:
            json.dump(manifest, handle, indent=2)
            handle.write("\n")
        manifest_path.chmod(0o600)
        sync_file(manifest_path)
        sync_directory(staging)
        staging.rename(root / backup_id)
        sync_directory(root)
        return backup_id
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--keep-days", type=int, default=14)
    parser.add_argument("--keep-minimum", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--prune-only", action="store_true")
    args = parser.parse_args()
    if args.keep_days < 1 or args.keep_minimum < 1 or args.timeout < 1 or (not args.prune_only and args.source is None):
        parser.error("Positive retention/time limits and a source for snapshots are required")
    os.umask(0o077)
    try:
        root = private_directory(args.destination)
        backup_id = None if args.prune_only else snapshot(args.source, root, args.timeout)
        removed = prune(root, args.keep_days, args.keep_minimum)
        print(json.dumps({"ok": True, "backupId": backup_id, "expiredBundlesRemoved": removed}))
    except Exception:
        # SQLite exceptions may include private filesystem paths; never print them.
        print(json.dumps({"ok": False, "error": "online_backup_failed"}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
