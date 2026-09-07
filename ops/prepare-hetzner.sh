#!/usr/bin/env bash
set -euo pipefail

# Run on the existing Ubuntu x86_64 server as root. This prepares only the
# calendar account/directories/runtime; it does not start or alter any service.
[[ "$(id -u)" == 0 ]] || { printf '%s\n' 'Run as root on the calendar server.' >&2; exit 1; }
[[ "$(uname -m)" == x86_64 ]] || { printf '%s\n' 'This pinned binary requires x86_64.' >&2; exit 1; }

calendar_node_version='24.20.0'
calendar_node_archive="node-v${calendar_node_version}-linux-x64.tar.xz"
calendar_node_sha256='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2'
calendar_release_url="https://nodejs.org/download/release/v${calendar_node_version}"
calendar_runtime_dir='/opt/my-calendar/runtime'
calendar_version_dir="${calendar_runtime_dir}/node-v${calendar_node_version}-linux-x64"

for calendar_tool in curl tar xz sha256sum awk; do
  command -v "$calendar_tool" >/dev/null || { printf 'Missing required tool: %s\n' "$calendar_tool" >&2; exit 1; }
done

if ! id my-calendar >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/my-calendar \
    --no-create-home --shell /usr/sbin/nologin my-calendar
fi
install -d -o root -g root -m 0755 /opt/my-calendar "$calendar_runtime_dir" /opt/my-calendar/releases
install -d -o my-calendar -g my-calendar -m 0750 /var/lib/my-calendar
install -d -o root -g my-calendar -m 0750 /etc/my-calendar

if [[ ! -d "$calendar_version_dir" ]]; then
  calendar_download_dir="$(mktemp -d /tmp/my-calendar-node.XXXXXX)"
  trap 'rm -rf -- "$calendar_download_dir"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    "${calendar_release_url}/${calendar_node_archive}" \
    --output "${calendar_download_dir}/${calendar_node_archive}"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    "${calendar_release_url}/SHASUMS256.txt" \
    --output "${calendar_download_dir}/SHASUMS256.txt"
  calendar_upstream_sha256="$(awk -v archive="$calendar_node_archive" '$2 == archive { print $1 }' "${calendar_download_dir}/SHASUMS256.txt")"
  [[ "$calendar_upstream_sha256" == "$calendar_node_sha256" ]] || { printf '%s\n' 'Upstream checksum differs from the reviewed pinned checksum.' >&2; exit 1; }
  (
    cd "$calendar_download_dir"
    printf '%s  %s\n' "$calendar_node_sha256" "$calendar_node_archive" | sha256sum --check --strict
  )
  tar --extract --xz --file "${calendar_download_dir}/${calendar_node_archive}" \
    --directory "$calendar_runtime_dir" --no-same-owner
  chown -R root:root "$calendar_version_dir"
fi

[[ "$("${calendar_version_dir}/bin/node" --version)" == "v${calendar_node_version}" ]] || { printf '%s\n' 'Unexpected runtime version.' >&2; exit 1; }
if [[ -L "${calendar_runtime_dir}/node" ]]; then
  [[ "$(readlink -f "${calendar_runtime_dir}/node")" == "$calendar_version_dir" ]] || { printf '%s\n' 'A different calendar runtime is already selected; review before changing it.' >&2; exit 1; }
elif [[ -e "${calendar_runtime_dir}/node" ]]; then
  printf '%s\n' 'The calendar runtime path already exists and is not a symlink.' >&2
  exit 1
else
  ln -s "$calendar_version_dir" "${calendar_runtime_dir}/node"
fi

"${calendar_runtime_dir}/node/bin/node" --version
env PATH="${calendar_runtime_dir}/node/bin:/usr/local/bin:/usr/bin:/bin" \
  "${calendar_runtime_dir}/node/bin/npm" --version
printf '%s\n' 'Calendar account, directories, and isolated runtime are ready. No service was started.'
