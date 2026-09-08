#!/usr/bin/env python3
"""Apply/remove only the reviewed calendar memory-protection units as root.

Run beside the three example files on the server. Existing differing files are
refused. Changing a service's slice requires a restart of that service only.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def atomic_write(path, data):
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".calendar-resource-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fchmod(file.fileno(), 0o644)
            os.fsync(file.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def identities():
    database = Path("/var/lib/my-calendar/calendar.sqlite").stat()
    return {
        "database": (database.st_dev, database.st_ino),
        "environment": hashlib.sha256(Path("/etc/my-calendar/calendar.env").read_bytes()).digest(),
        "unrelatedProxy": run("systemctl", "show", "caddy.service", "-p", "MainPID", "--value"),
        "unrelatedProxyConfig": hashlib.sha256(Path("/etc/caddy/Caddyfile").read_bytes()).digest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remove", action="store_true", help="Remove only these exact reviewed settings and restart the two calendar services.")
    args = parser.parse_args()
    if os.getuid() != 0:
        raise SystemExit("Run as root on the calendar server.")
    source = Path(__file__).resolve().parent
    specs = [
        ("calendar.slice.example", "/etc/systemd/system/calendar.slice"),
        ("calendar-api-memory.conf.example", "/etc/systemd/system/my-calendar.service.d/30-calendar-memory.conf"),
        ("calendar-tls-memory.conf.example", "/etc/systemd/system/my-calendar-tls.service.d/30-calendar-memory.conf"),
    ]
    prepared = []
    for filename, target in specs:
        data = (source / filename).read_bytes()
        path = Path(target)
        for parent in [path, *path.parents]:
            if parent.is_symlink():
                raise SystemExit("A target or ancestor is a symlink; inspect before continuing.")
        old = None
        if path.exists():
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o644:
                raise SystemExit("An existing resource target has unexpected ownership or permissions.")
            old = path.read_bytes()
            if old != data:
                raise SystemExit("An existing resource target differs from the reviewed configuration.")
        prepared.append((path, old, None if args.remove else data))
    services = ("my-calendar.service", "my-calendar-tls.service")
    for service in services:
        run("systemctl", "is-active", "--quiet", service)
        if run("systemctl", "show", service, "-p", "Slice", "--value") not in ("system.slice", "calendar.slice"):
            raise SystemExit("Calendar service has an unexpected slice; inspect before continuing.")
    before = identities()
    changed = any(old != new for _, old, new in prepared)
    try:
        if changed:
            for path, old, new in prepared:
                if old == new:
                    continue
                if new is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, new)
            run("systemctl", "daemon-reload")
            for service in services:
                run("systemctl", "restart", service)
        for service, protected in zip(services, (256 * 1024**2, 64 * 1024**2)):
            run("systemctl", "is-active", "--quiet", service)
            expected_slice = "system.slice" if args.remove else "calendar.slice"
            if run("systemctl", "show", service, "-p", "Slice", "--value") != expected_slice:
                raise RuntimeError("Calendar slice did not take effect.")
            if not args.remove:
                group = run("systemctl", "show", service, "-p", "ControlGroup", "--value")
                if int(Path("/sys/fs/cgroup" + group, "memory.low").read_text()) != protected:
                    raise RuntimeError("Calendar memory protection did not take effect.")
        if not args.remove and int(Path("/sys/fs/cgroup/calendar.slice/memory.low").read_text()) != 320 * 1024**2:
            raise RuntimeError("Parent memory protection did not take effect.")
        if identities() != before:
            raise RuntimeError("Persistent identity or unrelated proxy changed; inspect before continuing.")
    except Exception:
        if changed:
            for path, old, _ in prepared:
                if old is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, old)
            run("systemctl", "daemon-reload")
            for service in services:
                run("systemctl", "restart", service)
        raise
    print(json.dumps({"changed": changed, "protected": not args.remove, "calendarServicesActive": True,
                      "databaseIdentityPreserved": True, "environmentPreserved": True, "unrelatedProxyPreserved": True}))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        raise SystemExit("A calendar unit operation failed. Inspect the unit state; no private output was printed.")
