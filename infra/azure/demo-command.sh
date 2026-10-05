#!/bin/sh
# Runs one allow-listed demo command on the Azure VM, as adili, from /opt/adili.
# Called by the "Azure demo command" workflow (.github/workflows/azure-demo-command.yml):
#
#   infra/azure/demo-command.sh seed
#   infra/azure/demo-command.sh reset 0-start
#   infra/azure/demo-command.sh ai replay|anthropic|record
#   infra/azure/demo-command.sh check
#   infra/azure/demo-command.sh health
#   infra/azure/demo-command.sh diagnose
#
# The workflow's log is public (a public repo), so everything printed goes through `redact`.
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
PUBLIC_ENV="${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
HOME="${HOME:-/home/adili}"
export HOME
PATH="/usr/bin:/usr/local/bin:${HOME}/.local/bin:${HOME}/.local/share/pnpm:${PATH:-/usr/bin}"
export PATH
cd "$ROOT"

cmd="${1:-}"
arg="${2:-}"

# Arguments reach a shell on the VM: allow names only.
case "$arg" in
  *[!A-Za-z0-9._-]*)
    echo "Invalid argument: $arg" >&2
    exit 2
    ;;
esac

# Masks what looks like a credential: API keys, bearer tokens and JWTs, demo tickets, and the
# value after a secret-, password-, token- or key-named field.
redact() {
  sed -E \
    -e 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-[redacted]/g' \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?/[jwt redacted]/g' \
    -e 's/([Bb]earer )[A-Za-z0-9._~+\/=-]+/\1[redacted]/g' \
    -e 's/(demo_ticket=)[^&" ]+/\1[redacted]/g' \
    -e 's/(([A-Za-z_-]*([Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Pp][Ii]_?[Kk][Ee][Yy])[A-Za-z_-]*)"?[=:] *"?)[^", &]+/\1[redacted]/g'
}

# Runs a command with its output redacted, keeping its exit status.
run() {
  status_file="$(mktemp)"
  {
    status=0
    "$@" 2>&1 || status=$?
    echo "$status" >"$status_file"
  } | redact
  status="$(cat "$status_file")"
  rm -f "$status_file"
  return "$status"
}

# Reachability, health and the recent log of what is down, for debugging the VM without SSH.
diagnose() {
  echo "== Health"
  health="$(pnpm --silent health 2>&1 || true)"
  printf '%s\n' "$health" | redact
  echo
  echo "== Real backend"
  if pnpm --silent demo:check >/dev/null 2>&1; then
    echo "every mock off, AI provider real"
  else
    echo "NOT on the real backend: see the [mocks] and [AI provider] notes above"
  fi
  echo
  echo "== Keycloak"
  set -a
  # shellcheck disable=SC1090
  . "$PUBLIC_ENV"
  set +a
  # shellcheck disable=SC1091
  . "$ROOT/infra/azure/demo-vault.sh"
  for url in http://127.0.0.1:18080/realms/adili "${KC_HOSTNAME%/}/realms/adili"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
      "$url/.well-known/openid-configuration" || true)"
    echo "$url discovery: $code"
  done
  echo
  echo "== Containers"
  docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.azure.yml \
    ps --format '{{.Service}}\t{{.State}}\t{{.Status}}' 2>&1 | redact || true
  # The last log lines of each app or service the health check reports down.
  printf '%s\n' "$health" | awk '$2 != "up" && NF > 1 { print $1 }' | while read -r name; do
    echo
    echo "== Log: $name (last 40 lines)"
    journalctl -u adili-apps --since '-2h' --no-pager -o cat 2>&1 |
      grep -F "@adili/$name:" | tail -n 40 | redact || true
  done
  if ! curl -sf -o /dev/null --max-time 5 http://127.0.0.1:18080/realms/adili; then
    echo
    echo "== Log: keycloak (last 40 lines)"
    docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.azure.yml \
      logs --no-color --tail 40 keycloak 2>&1 | redact || true
  fi
}

case "$cmd" in
  seed) run pnpm demo:seed ;;
  reset)
    if [ -z "$arg" ]; then
      echo "usage: $0 reset <checkpoint>" >&2
      exit 2
    fi
    run pnpm demo:reset "$arg"
    ;;
  ai)
    case "$arg" in
      anthropic | record | replay) run pnpm demo:ai "$arg" ;;
      *)
        echo "usage: $0 ai anthropic|record|replay" >&2
        exit 2
        ;;
    esac
    ;;
  check) run pnpm demo:check ;;
  health) run pnpm health ;;
  diagnose) diagnose ;;
  *)
    echo "usage: $0 seed|reset <checkpoint>|ai <mode>|check|health|diagnose" >&2
    exit 2
    ;;
esac
