#!/usr/bin/env bash
set -euo pipefail
umask 077
calendar_ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${calendar_ops_dir}/load-deployment.sh"
calendar_ssh_helper="${calendar_ops_dir}/ssh-calendar.sh"
calendar_remote_db="${CALENDAR_REMOTE_DB_PATH:-/var/lib/my-calendar/calendar.sqlite}"
calendar_remote_backups="${CALENDAR_REMOTE_BACKUP_ROOT:-/var/backups/my-calendar}"
calendar_local_backups="${calendar_ops_dir}/local/backups"
calendar_reports="${calendar_ops_dir}/local/backup-reports"
calendar_key_env="${CALENDAR_BACKUP_KEY_ENV_FILE:-${calendar_ops_dir}/../server/.env.production}"
calendar_node="${CALENDAR_BACKUP_NODE:-node}"
# Restricted absolute paths make remote shell interpolation unambiguous.
for calendar_path in "$calendar_remote_db" "$calendar_remote_backups"; do
  [[ "$calendar_path" =~ ^/[A-Za-z0-9_./-]+$ && "$calendar_path" != *'/../'* ]] || { printf '%s\n' 'Remote backup paths must be simple absolute paths.' >&2; exit 1; }
done
[[ -f "$calendar_key_env" && ! -L "$calendar_key_env" ]] || { printf '%s\n' 'A separate private environment containing the matching encryption key is required.' >&2; exit 1; }
python3 - "$calendar_key_env" "$calendar_local_backups" "$calendar_reports" <<'PY'
from pathlib import Path
import os,sys
key=Path(sys.argv[1])
if key.stat().st_mode & 0o077 or key.stat().st_uid != os.geteuid(): raise SystemExit('The key environment must be owner-only.')
for value in sys.argv[2:]:
    path=Path(value)
    if path.is_symlink(): raise SystemExit('Backup directories cannot be symlinks.')
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.stat().st_uid != os.geteuid(): raise SystemExit('Backup directory ownership does not match.')
    path.chmod(0o700)
PY
calendar_result="$(bash "$calendar_ssh_helper" "python3 - --source '$calendar_remote_db' --destination '$calendar_remote_backups'" < "${calendar_ops_dir}/backup-calendar.py")"
calendar_backup_id="$(python3 -c 'import json,sys; result=json.loads(sys.argv[1]); assert result["ok"]; print(result["backupId"])' "$calendar_result")"
[[ "$calendar_backup_id" =~ ^calendar-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || { printf '%s\n' 'Unexpected backup identifier.' >&2; exit 1; }
calendar_staging="$(mktemp -d "${calendar_local_backups}/.download-XXXXXXXX")"
trap 'rm -rf -- "$calendar_staging"' EXIT
for calendar_file in calendar.sqlite manifest.json; do
  bash "$calendar_ssh_helper" "cat '$calendar_remote_backups/$calendar_backup_id/$calendar_file'" > "${calendar_staging}/${calendar_file}"
  chmod 0600 "${calendar_staging}/${calendar_file}"
done
env -u CALENDAR_ENCRYPTION_KEY "$calendar_node" --env-file="$calendar_key_env" "${calendar_ops_dir}/verify-backup.mjs" --backup "$calendar_staging" --report "${calendar_reports}/${calendar_backup_id}.json"
mv "$calendar_staging" "${calendar_local_backups}/${calendar_backup_id}"
trap - EXIT
python3 "${calendar_ops_dir}/backup-calendar.py" --prune-only --destination "$calendar_local_backups"
printf '%s\n' 'Online backup copied off-host and verified in disposable storage. Live calendar and services were not changed.'
