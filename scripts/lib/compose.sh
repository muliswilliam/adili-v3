# Shared Docker / Podman Compose helper. Source from the other infra scripts.
# Needs Node (the repo prerequisite) to read the compose config.
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

# Compose services, one per line: `init` lists the one-shot jobs labelled `adili.init-job` in the
# compose file, `long-running` the rest. Fails when `compose config` fails or the list is empty.
compose_services() {
  config=$(compose config --format json) || return
  # shellcheck disable=SC2016 # the program is JavaScript, not shell
  printf '%s' "$config" | KIND="$1" node -e '
    let json = "";
    process.stdin.on("data", (chunk) => (json += chunk)).on("end", () => {
      const init = process.env.KIND === "init";
      const names = Object.entries(JSON.parse(json).services)
        .filter(([, service]) => (service.labels?.["adili.init-job"] === "true") === init)
        .map(([name]) => name);
      if (names.length === 0) {
        console.error(`No ${process.env.KIND} services in the compose file`);
        process.exit(1);
      }
      console.log(names.join("\n"));
    });
  '
}
