#!/usr/bin/env bash
# Source only trusted local operator configuration; never commit real deployment values.
calendar_ops_config_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${calendar_ops_config_dir}/local/deployment.env" ]]; then
  # shellcheck source=/dev/null
  source "${calendar_ops_config_dir}/local/deployment.env"
fi
