# Shared Docker / Podman Compose helper. Source from the other infra scripts.
# Override with COMPOSE_BIN, e.g. COMPOSE_BIN="podman compose".
# shellcheck shell=sh

compose_file() {
  echo "$(CDPATH= cd -- "$(dirname "$0")/../infra/compose" && pwd)/docker-compose.yml"
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
