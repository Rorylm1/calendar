#!/usr/bin/env bash
set -euo pipefail

# A trusted ignored local file may provide defaults; explicit environment values win.
calendar_ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${calendar_ops_dir}/load-deployment.sh"
: "${CALENDAR_SSH_IDENTITY:?Set CALENDAR_SSH_IDENTITY in your environment or ops/local/deployment.env}"
: "${CALENDAR_SSH_TARGET:?Set CALENDAR_SSH_TARGET in your environment or ops/local/deployment.env}"
calendar_ssh_identity="$CALENDAR_SSH_IDENTITY"
calendar_ssh_target="$CALENDAR_SSH_TARGET"
calendar_connect_timeout="${CALENDAR_SSH_CONNECT_TIMEOUT:-8}"
[[ "$calendar_connect_timeout" =~ ^[1-9][0-9]?$ && "$calendar_connect_timeout" -le 60 ]] || { printf '%s\n' 'SSH connect timeout must be between 1 and 60 seconds.' >&2; exit 1; }
calendar_control_options=()
if [[ -n "${CALENDAR_SSH_CONTROL_PATH:-}" ]]; then
  calendar_control_options=(-o "ControlPath=${CALENDAR_SSH_CONTROL_PATH}" -o ControlMaster=no)
fi

exec ssh \
  -i "$calendar_ssh_identity" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o IPQoS=none \
  -o ConnectTimeout="$calendar_connect_timeout" \
  -o StrictHostKeyChecking=yes \
  ${calendar_control_options[@]+"${calendar_control_options[@]}"} \
  "$calendar_ssh_target" "$@"
