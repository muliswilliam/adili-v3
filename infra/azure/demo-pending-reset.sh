#!/bin/sh
# adili-apps' ExecStartPre (#621): if demo-reset.sh left a request, restores that checkpoint now,
# while every app and service is stopped. Never fails the unit: whatever happens, the apps start,
# and the outcome is in ~/.local/state/adili/demo-reset-last and ~/adili-demo-reset.log.
ROOT="${ADILI_ROOT:-/opt/adili}"
HOME="${HOME:-/home/adili}"
STATE="${ADILI_DEMO_STATE:-$HOME/.local/state/adili}"
PATH="/usr/bin:/usr/local/bin:${HOME}/.local/bin:${HOME}/.local/share/pnpm:${PATH:-/usr/bin}"
export HOME PATH

[ -f "$STATE/demo-reset-request" ] || exit 0
read -r request name <"$STATE/demo-reset-request"
rm -f "$STATE/demo-reset-request"

started=$(date +%s)
# systemd has stopped the apps; Caddy keeps the public ports, so skip the local port check.
if ADILI_RESTORE_RUNNING_APPS=yes "$ROOT/scripts/demo-checkpoint.sh" restore "$name" >>"$HOME/adili-demo-reset.log" 2>&1; then
  outcome=ok
  # A checkpoint captured before a deploy holds the schema of then: bring it to this checkout's.
  (cd "$ROOT" && pnpm db:migrate) >>"$HOME/adili-demo-reset.log" 2>&1 || outcome=migrate-failed
else
  outcome=failed
fi
printf '%s %s %s %ss %s\n' "$request" "$name" "$outcome" "$(($(date +%s) - started))" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STATE/demo-reset-last"
exit 0
