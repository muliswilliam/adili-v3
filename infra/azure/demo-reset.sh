#!/bin/sh
# `pnpm demo:reset <checkpoint>` on the Azure host (#621). The restore needs every app and service
# stopped (Temporal workers cache workflow state), and the apps run under systemd as adili-apps,
# which adili may only restart through the root helper. So this leaves a request and restarts
# adili-apps; the unit's ExecStartPre (demo-pending-reset.sh) restores while the apps are down,
# then the apps start on the restored stack.
#
#   infra/azure/demo-reset.sh <checkpoint>             waits until the apps are back
#   infra/azure/demo-reset.sh --detach <checkpoint>    returns once the restart is asked for
#                                                      (the console's demo panel: it is stopped too)
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
ROOT_HELPER="${ADILI_ROOT_HELPER:-/usr/local/sbin/adili-demo-root}"
HOME="${HOME:-/home/adili}"
STATE="${ADILI_DEMO_STATE:-$HOME/.local/state/adili}"
PATH="/usr/bin:/usr/local/bin:${HOME}/.local/bin:${HOME}/.local/share/pnpm:${PATH:-/usr/bin}"
export HOME PATH

detach=''
if [ "${1:-}" = --detach ]; then
  detach=yes
  shift
fi
name="${1:-}"
if [ -z "$name" ] || [ $# -ne 1 ]; then
  echo "usage: $0 [--detach] <checkpoint>" >&2
  exit 2
fi
if ! "$ROOT/scripts/demo-checkpoint.sh" exists "$name"; then
  echo "No complete checkpoint $name on this host:" >&2
  "$ROOT/scripts/demo-checkpoint.sh" list >&2
  exit 1
fi

mkdir -p "$STATE"
request="$(date -u +%Y%m%dT%H%M%SZ)-$$"
printf '%s %s\n' "$request" "$name" >"$STATE/demo-reset-request"
echo "Resetting the demo to $name: restarting the apps (restore runs while they are down)"

if [ -n "$detach" ]; then
  # The restart stops this process's own app with it; systemd carries the job on.
  nohup sudo -n "$ROOT_HELPER" restart-apps >/dev/null 2>&1 &
  exit 0
fi

started=$(date +%s)
sudo -n "$ROOT_HELPER" restart-apps
if ! grep -q "^$request " "$STATE/demo-reset-last" 2>/dev/null; then
  echo "The restore did not run; see $HOME/adili-demo-reset.log" >&2
  exit 1
fi
cat "$STATE/demo-reset-last"
grep -q "^$request $name ok " "$STATE/demo-reset-last" || exit 1

echo "Waiting for the apps"
until node "$ROOT/scripts/health.mjs" >/dev/null 2>&1; do
  if [ $(($(date +%s) - started)) -gt 600 ]; then
    node "$ROOT/scripts/health.mjs" || true
    echo "The apps are not all up 10 minutes after the reset" >&2
    exit 1
  fi
  sleep 3
done
echo "Demo reset to $name, apps up, in $(($(date +%s) - started))s"
