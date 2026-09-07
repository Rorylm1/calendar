#!/usr/bin/env bash
set -euo pipefail

# Run locally after backend tests pass and its source is frozen.
# Secrets travel only over SSH stdin into the protected configuration directory.
calendar_preserve_env=false
if [[ $# -gt 1 ]]; then printf '%s\n' 'Usage: deploy-backend.sh [--preserve-env]' >&2; exit 1; fi
case "${1:-}" in
  '') ;;
  --preserve-env) calendar_preserve_env=true ;;
  *) printf '%s\n' 'Usage: deploy-backend.sh [--preserve-env]' >&2; exit 1 ;;
esac
calendar_ops_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
calendar_project_dir="$(cd -- "${calendar_ops_dir}/.." && pwd)"
source "${calendar_ops_dir}/load-deployment.sh"
: "${CALENDAR_SSH_TARGET:?Set CALENDAR_SSH_TARGET in your environment or ops/local/deployment.env}"
: "${CALENDAR_BACKEND_ORIGIN:?Set the HTTPS backend origin in your environment or ops/local/deployment.env}"
: "${CALENDAR_PROTECTED_SERVICE:=caddy.service}"
[[ "$CALENDAR_BACKEND_ORIGIN" == https://* ]] || { printf '%s\n' 'The backend origin must use HTTPS.' >&2; exit 1; }
[[ "$CALENDAR_PROTECTED_SERVICE" =~ ^[a-zA-Z0-9@_.-]+\.service$ ]] || { printf '%s\n' 'The protected service must be a systemd service name.' >&2; exit 1; }
calendar_release_id="$(date -u +%Y%m%dT%H%M%SZ)"
calendar_release_dir="/opt/my-calendar/releases/${calendar_release_id}"
calendar_manifest="${calendar_ops_dir}/releases/${calendar_release_id}.json"
calendar_env_file="${calendar_project_dir}/server/.env.production"
calendar_ssh_helper="${calendar_ops_dir}/ssh-calendar.sh"
if [[ "$calendar_preserve_env" == true ]]; then
  calendar_live_state_before="$(bash "$calendar_ssh_helper" 'set -e
test -s /etc/my-calendar/calendar.env
test -f /var/lib/my-calendar/calendar.sqlite
sha256sum /etc/my-calendar/calendar.env
stat -c "%d:%i" /var/lib/my-calendar/calendar.sqlite')"
  bash "$calendar_ssh_helper" '/opt/my-calendar/runtime/node/bin/node --env-file=/etc/my-calendar/calendar.env --input-type=module' <<'JS'
import { resolve } from 'node:path';
if (process.env.HOST !== '127.0.0.1' || process.env.PORT !== '8100' || resolve(process.env.CALENDAR_DB_PATH || '') !== '/var/lib/my-calendar/calendar.sqlite') {
  throw new Error('The live backend listener or persistent database path requires review.');
}
JS
else
  [[ -f "$calendar_env_file" ]] || { printf '%s\n' 'The private production environment is missing.' >&2; exit 1; }
fi
calendar_existing_services="$(bash "$calendar_ssh_helper" "sha256sum /etc/caddy/Caddyfile
systemctl show caddy.service ${CALENDAR_PROTECTED_SERVICE} -p MainPID --value")"
mkdir -p "${calendar_ops_dir}/releases"

python3 - "${calendar_project_dir}/server" "$calendar_manifest" "$calendar_release_id" "$calendar_preserve_env" "$CALENDAR_SSH_TARGET" <<'PY'
from pathlib import Path
import hashlib,json,re,sys
source,manifest,release=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
preserve_env=sys.argv[4]=='true'
if not preserve_env:
    env={}
    for line in (source/'.env.production').read_text().splitlines():
        match=re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$',line)
        if match:env[match.group(1)]=match.group(2).strip().strip('"\'')
    if env.get('HOST')!='127.0.0.1' or env.get('PORT')!='8100':
        raise SystemExit('Production HOST/PORT must be the calendar loopback listener.')
    database=Path(env.get('CALENDAR_DB_PATH',''))
    if not database.is_absolute() or not database.resolve().is_relative_to('/var/lib/my-calendar'):
        raise SystemExit('Production database must be beneath /var/lib/my-calendar.')
files=[source/'package.json',source/'package-lock.json']
for path in (source/'src').rglob('*'):
    if path.is_symlink():raise SystemExit('Release source cannot contain symlinks.')
    if path.is_file():files.append(path)
manifest.write_text(json.dumps({
    'release':release,'target':sys.argv[5],
    'runtime':'Node 24.20.0','entrypoint':'node --import tsx src/index.ts',
    'environmentMode':'preserved' if preserve_env else 'uploaded',
    'sourceFiles':{str(path.relative_to(source)):hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(files)}
},indent=2)+'\n')
print('Release manifest:',manifest)
PY

bash "$calendar_ssh_helper" "set -e
test ! -e '${calendar_release_dir}'
install -d -o root -g root -m 0755 '${calendar_release_dir}'"
tar --no-xattrs -C "${calendar_project_dir}/server" -cf - package.json package-lock.json src | \
  bash "$calendar_ssh_helper" "tar -xf - -C '${calendar_release_dir}'"
bash "$calendar_ssh_helper" "cat > '${calendar_release_dir}/release-manifest.json'" < "$calendar_manifest"

bash "$calendar_ssh_helper" "python3 - '${calendar_release_dir}'" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
release=Path(sys.argv[1]); manifest=json.loads((release/'release-manifest.json').read_text())
for name,expected in manifest['sourceFiles'].items():
    if hashlib.sha256((release/name).read_bytes()).hexdigest()!=expected:
        raise SystemExit('Release checksum mismatch: '+name)
subprocess.run(['chown','-R','my-calendar:my-calendar',str(release)],check=True)
subprocess.run(['runuser','-u','my-calendar','--','env',
    'PATH=/opt/my-calendar/runtime/node/bin:/usr/local/bin:/usr/bin:/bin',
    'npm_config_cache=/var/lib/my-calendar/.npm',
    '/opt/my-calendar/runtime/node/bin/npm','ci','--omit=dev','--no-audit','--no-fund'],cwd=release,check=True)
subprocess.run(['chown','-R','root:root',str(release)],check=True)
for path in [release,*release.rglob('*')]:
    if path.is_symlink():continue
    mode=path.stat().st_mode
    path.chmod(0o755 if path.is_dir() else (mode & 0o777 & ~0o022)|0o644)
print('Source checksums matched; production dependencies installed; release is root owned.')
PY

if [[ "$calendar_preserve_env" != true ]]; then
  bash "$calendar_ssh_helper" 'set -e
umask 077
cat > /etc/my-calendar/calendar.env.next
chown root:my-calendar /etc/my-calendar/calendar.env.next
chmod 0640 /etc/my-calendar/calendar.env.next
mv -T /etc/my-calendar/calendar.env.next /etc/my-calendar/calendar.env' < "$calendar_env_file"
fi
bash "$calendar_ssh_helper" 'set -e
cat > /etc/systemd/system/my-calendar.service
chmod 0644 /etc/systemd/system/my-calendar.service
systemd-analyze verify /etc/systemd/system/my-calendar.service' < "${calendar_ops_dir}/my-calendar.service.example"

bash "$calendar_ssh_helper" "set -e
if [ -e /opt/my-calendar/current ] && [ ! -L /opt/my-calendar/current ]; then exit 1; fi
ln -s '${calendar_release_dir}' '/opt/my-calendar/current-${calendar_release_id}'
mv -Tf '/opt/my-calendar/current-${calendar_release_id}' /opt/my-calendar/current
systemctl daemon-reload
systemctl enable my-calendar.service
systemctl restart my-calendar.service
systemctl is-active --quiet my-calendar.service
systemctl is-active --quiet my-calendar-tls.service
systemctl is-active --quiet caddy.service
systemctl is-active --quiet ${CALENDAR_PROTECTED_SERVICE}"
calendar_existing_services_after="$(bash "$calendar_ssh_helper" "sha256sum /etc/caddy/Caddyfile
systemctl show caddy.service ${CALENDAR_PROTECTED_SERVICE} -p MainPID --value")"
[[ "$calendar_existing_services_after" == "$calendar_existing_services" ]] || { printf '%s\n' 'The existing proxy configuration or protected service process changed; inspect before continuing.' >&2; exit 1; }
if [[ "$calendar_preserve_env" == true ]]; then
  calendar_live_state_after="$(bash "$calendar_ssh_helper" 'set -e
sha256sum /etc/my-calendar/calendar.env
stat -c "%d:%i" /var/lib/my-calendar/calendar.sqlite')"
  [[ "$calendar_live_state_after" == "$calendar_live_state_before" ]] || { printf '%s\n' 'The live environment bytes or persistent database file identity changed; inspect before continuing.' >&2; exit 1; }
  printf '%s\n' 'Live environment bytes and persistent database file identity were preserved.'
fi
python3 - "$CALENDAR_BACKEND_ORIGIN" <<'PY'
import json,time,urllib.request,urllib.error,sys
base=sys.argv[1].rstrip('/')
for attempt in range(30):
    try:
        with urllib.request.urlopen(base+'/health',timeout=5) as response:
            if response.status==200 and json.load(response)=={'ok':True}:break
    except (urllib.error.URLError,TimeoutError):pass
    time.sleep(0.3)
else:raise SystemExit('Backend did not become healthy after restart.')
try:
    with urllib.request.urlopen(base+'/v1/state',timeout=10) as response:
        raise SystemExit('Unauthenticated state request was not rejected.')
except urllib.error.HTTPError as error:
    if error.code!=401:raise SystemExit('Unexpected unauthenticated state response.')
print('Trusted HTTPS health and unauthenticated rejection verified.')
PY
printf 'Backend release started: %s\n' "$calendar_release_id"
if [[ "$calendar_preserve_env" == true ]]; then
  printf '%s\n' 'No Gmail synchronization request was sent by this deployment script.'
else
  printf '%s\n' 'Verify persistence before connecting Gmail for the first time.'
fi
