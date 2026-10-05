#!/bin/sh
# Runs one allow-listed demo command on the Azure VM, as adili, from /opt/adili.
# Called by the "Azure demo command" workflow (.github/workflows/azure-demo-command.yml):
#
#   infra/azure/demo-command.sh seed
#   infra/azure/demo-command.sh reset 0-start
#   infra/azure/demo-command.sh ai replay|anthropic|record
#   infra/azure/demo-command.sh check
#   infra/azure/demo-command.sh health
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
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

case "$cmd" in
  seed) exec pnpm demo:seed ;;
  reset)
    if [ -z "$arg" ]; then
      echo "usage: $0 reset <checkpoint>" >&2
      exit 2
    fi
    exec pnpm demo:reset "$arg"
    ;;
  ai)
    case "$arg" in
      anthropic | record | replay) exec pnpm demo:ai "$arg" ;;
      *)
        echo "usage: $0 ai anthropic|record|replay" >&2
        exit 2
        ;;
    esac
    ;;
  check) exec pnpm demo:check ;;
  health) exec pnpm health ;;
  *)
    echo "usage: $0 seed|reset <checkpoint>|ai <mode>|check|health" >&2
    exit 2
    ;;
esac
