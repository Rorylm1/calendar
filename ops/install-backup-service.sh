#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run as root on the calendar server, beside the three reviewed source files.
# Existing, differing target files are refused rather than silently replaced.
[[ $# -eq 0 && "$(id -u)" == 0 ]] || { printf '%s\n' 'Run without arguments as root on the calendar server.' >&2; exit 1; }
calendar_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
calendar_stage="$(mktemp -d /tmp/calendar-backup-install.XXXXXXXX)"
trap 'rm -rf -- "$calendar_stage"' EXIT
[[ -f /var/lib/my-calendar/calendar.sqlite && ! -L /var/lib/my-calendar/calendar.sqlite ]] || { printf '%s\n' 'The existing calendar database must be a regular file.' >&2; exit 1; }
[[ -x /usr/bin/python3 ]] || { printf '%s\n' 'Python 3 is required.' >&2; exit 1; }
systemctl cat my-calendar.service >/dev/null
/usr/bin/python3 -I - <<'PY'
import sqlite3
if not hasattr(sqlite3.Connection, 'backup'):
    raise SystemExit('Python SQLite online backup support is required.')
PY
for calendar_file in backup-calendar.py my-calendar-backup.service.example my-calendar-backup.timer.example; do
  [[ -f "${calendar_source_dir}/${calendar_file}" && ! -L "${calendar_source_dir}/${calendar_file}" ]] || { printf '%s\n' 'The reviewed backup utility and unit examples must accompany this installer.' >&2; exit 1; }
done
cp "${calendar_source_dir}/my-calendar-backup.service.example" "${calendar_stage}/my-calendar-backup.service"
cp "${calendar_source_dir}/my-calendar-backup.timer.example" "${calendar_stage}/my-calendar-backup.timer"
systemd-analyze verify "${calendar_stage}/my-calendar-backup.service" "${calendar_stage}/my-calendar-backup.timer"

# Refuse symlinks and unexpected replacements before making installation changes.
python3 - "${calendar_source_dir}" <<'PY'
from pathlib import Path
import os,sys
source=Path(sys.argv[1])
for directory in [Path('/opt/my-calendar'), Path('/opt/my-calendar/ops'), Path('/var/backups/my-calendar')]:
    if directory.is_symlink(): raise SystemExit('A calendar installation directory is a symlink; inspect it before continuing.')
    if directory.exists() and directory.stat().st_uid != 0: raise SystemExit('A calendar installation directory is not root-owned.')
for name,target in [
    ('backup-calendar.py', '/opt/my-calendar/ops/backup-calendar.py'),
    ('my-calendar-backup.service.example', '/etc/systemd/system/my-calendar-backup.service'),
    ('my-calendar-backup.timer.example', '/etc/systemd/system/my-calendar-backup.timer'),
]:
    path=Path(target)
    if path.is_symlink(): raise SystemExit('A backup installation target is a symlink; inspect it before continuing.')
    if path.exists() and (not path.is_file() or path.stat().st_uid != 0 or path.read_bytes() != (source/name).read_bytes()):
        raise SystemExit('A differing backup utility or unit already exists. Review the update explicitly before replacing it.')
PY
install -d -o root -g root -m 0755 /opt/my-calendar/ops
install -d -o root -g root -m 0700 /var/backups/my-calendar
install -o root -g root -m 0644 "${calendar_source_dir}/backup-calendar.py" /opt/my-calendar/ops/backup-calendar.py
install -o root -g root -m 0644 "${calendar_stage}/my-calendar-backup.service" /etc/systemd/system/my-calendar-backup.service
install -o root -g root -m 0644 "${calendar_stage}/my-calendar-backup.timer" /etc/systemd/system/my-calendar-backup.timer
systemctl daemon-reload
# Exercise the exact restricted service before enabling future runs.
systemctl start my-calendar-backup.service
[[ "$(systemctl show my-calendar-backup.service -p Result --value)" == success && "$(systemctl show my-calendar-backup.service -p ExecMainStatus --value)" == 0 ]] || { printf '%s\n' 'The isolated backup service did not pass; the timer was not enabled.' >&2; exit 1; }
systemctl enable --now my-calendar-backup.timer
systemctl is-enabled --quiet my-calendar-backup.timer
systemctl is-active --quiet my-calendar-backup.timer
printf '%s\n' 'Calendar backup service passed and its daily timer is enabled. No calendar or unrelated service was restarted.'
systemctl show my-calendar-backup.timer -p NextElapseUSecRealtime --value
