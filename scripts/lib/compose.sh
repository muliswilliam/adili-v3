# Shared Docker / Podman Compose helper. Source from the other infra scripts.
# Override with COMPOSE_BIN, e.g. COMPOSE_BIN="podman compose".
# shellcheck shell=sh

compose_file() {
  echo "$(CDPATH='' cd -- "$(dirname "$0")/../infra/compose" && pwd)/docker-compose.yml"
}

compose_bin() {
  if [ -n "${COMPOSE_BIN:-}" ]; then
    echo "$COMPOSE_BIN"
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi
  if command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    echo "podman compose"
    return
  fi
  echo "Need Docker Compose or Podman Compose on PATH" >&2
  exit 1
}

compose() {
  # shellcheck disable=SC2086
  $(compose_bin) -f "$(compose_file)" "$@"
}

# One-shot jobs that exit once done. `infra-up.sh` runs them after the long-running services,
# and `infra-health.sh` leaves them out, so add every new init job here.
INIT_JOBS="temporal-schema temporal-namespace seaweedfs-buckets openbao-keys"

long_running_services() {
  compose config --services | JOBS="$INIT_JOBS" awk '
    BEGIN { n = split(ENVIRON["JOBS"], jobs, " "); for (i = 1; i <= n; i++) skip[jobs[i]] = 1 }
    !($0 in skip)
  '
}
