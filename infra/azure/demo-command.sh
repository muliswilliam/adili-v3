#!/bin/sh
# Runs one allow-listed demo command on the Azure VM, as adili, from /opt/adili.
# Called by the "Azure demo command" workflow (.github/workflows/azure-demo-command.yml):
#
#   infra/azure/demo-command.sh seed
#   infra/azure/demo-command.sh reset 0-start
#   infra/azure/demo-command.sh checkpoints [<from>]   play the beats and capture every checkpoint
#   infra/azure/demo-command.sh checkpoint [<name>]    capture the stack as <name>; list without
#   infra/azure/demo-command.sh ai replay|anthropic|record
#   infra/azure/demo-command.sh e2e-accounts [resend]   the real end-to-end test accounts
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

# The real end-to-end test accounts (docs/demo-accounts.md) at the domain of this host's SMTP
# settings (infra/azure/demo-vault.sh). `resend` emails the setup link again to the accounts that
# have not finished setting up.
e2e_accounts() {
  # shellcheck disable=SC1091
  . "$ROOT/infra/azure/demo-vault.sh"
  domain="$(adili_e2e_email_domain)"
  if [ -z "$domain" ]; then
    echo "No SMTP settings on this host: set the repo's SMTP_* secrets and deploy." >&2
    return 1
  fi
  if [ ! -s "$ADILI_MAILPIT_RELAY_ENV" ]; then
    echo "WARNING: Mailpit relays nothing yet (deploy after setting the SMTP secrets); emails stay in Mailpit."
  fi
  run env E2E_EMAIL_DOMAIN="$domain" pnpm --silent e2e:accounts "$@"
}

case "$cmd" in
  seed) run pnpm demo:seed ;;
  wipe)
    # Every volume but ClamAV's goes (databases, Keycloak's realm, storage, OpenBao), then a normal deploy brings
    # the stack back with the realm imported fresh from the file, and the demo is seeded from
    # empty. For a host whose realm predates the file. Asks for `wipe yes`.
    if [ "$arg" != yes ]; then
      echo "usage: $0 wipe yes  (deletes all demo data)" >&2
      exit 2
    fi
    # The Azure overlay needs the public URLs and this host's Keycloak vault, as in deploy.sh.
    set -a
    # shellcheck disable=SC1090
    . "${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
    set +a
    # shellcheck disable=SC1091
    . "$ROOT/infra/azure/demo-vault.sh"
    sudo -n "${ADILI_ROOT_HELPER:-/usr/local/sbin/adili-demo-root}" stop-apps
    docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.azure.yml \
      down --remove-orphans
    # ClamAV's signature database stays: re-downloading it would hold up the seed's uploads.
    docker volume ls -q --filter label=com.docker.compose.project=adili |
      grep -v '_clamav-data$' | xargs -r docker volume rm
    run "$ROOT/infra/azure/deploy.sh"
    run pnpm db:seed
    run pnpm demo:seed
    ;;
  reset)
    if [ -z "$arg" ]; then
      echo "usage: $0 reset <checkpoint>" >&2
      exit 2
    fi
    run pnpm demo:reset "$arg"
    # The restore keeps the e2e staff, law-enforcement and applicant accounts; the declarant's
    # roster record and the e2e people in the registries come back from here when the checkpoint
    # predates them. A failure leaves the reset done.
    # shellcheck disable=SC1091
    if [ -n "$(. "$ROOT/infra/azure/demo-vault.sh" && adili_e2e_email_domain)" ]; then
      e2e_accounts || echo "WARNING: e2e accounts not checked after the reset; run e2e-accounts."
    fi
    ;;
  checkpoints)
    if [ -n "$arg" ]; then
      run pnpm demo:checkpoints --from "$arg"
    else
      run pnpm demo:checkpoints
    fi
    ;;
  checkpoint)
    if [ -n "$arg" ]; then
      run pnpm demo:checkpoint "$arg"
    else
      run "$ROOT/scripts/demo-checkpoint.sh" list
    fi
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
  e2e-accounts)
    case "$arg" in
      '') e2e_accounts ;;
      resend) e2e_accounts --resend ;;
      *)
        echo "usage: $0 e2e-accounts [resend]" >&2
        exit 2
        ;;
    esac
    ;;
  check) run pnpm demo:check ;;
  health) run pnpm health ;;
  diagnose) diagnose ;;
  *)
    echo "usage: $0 seed|wipe yes|reset <checkpoint>|checkpoints [<from>]|checkpoint [<name>]|ai <mode>|e2e-accounts [resend]|check|health|diagnose" >&2
    exit 2
    ;;
esac
