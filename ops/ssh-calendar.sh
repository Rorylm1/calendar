#!/usr/bin/env bash
set -euo pipefail

# A trusted ignored local file may provide defaults; explicit environment values win.
calendar_ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${calendar_ops_dir}/load-deployment.sh"
: "${CALENDAR_SSH_IDENTITY:?Set CALENDAR_SSH_IDENTITY in your environment or ops/local/deployment.env}"
: "${CALENDAR_SSH_TARGET:?Set CALENDAR_SSH_TARGET in your environment or ops/local/deployment.env}"
calendar_ssh_identity="$CALENDAR_SSH_IDENTITY"
calendar_ssh_target="$CALENDAR_SSH_TARGET"

exec ssh \
  -i "$calendar_ssh_identity" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=8 \
  -o StrictHostKeyChecking=yes \
  "$calendar_ssh_target" "$@"
