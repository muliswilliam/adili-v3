#!/bin/sh
# Fails unless every long-running compose service is running and healthy.
set -eu

# shellcheck source=SCRIPTDIR/lib/compose.sh
. "$(dirname "$0")/lib/compose.sh"

# Expected services come from the compose file, so a service that exited or was never
# created is reported as missing instead of silently dropping out of `compose ps`.
expected=$(long_running_services)
states=$(compose ps --all --format '{{.Service}} {{.State}} {{.Health}}')

if ! printf '%s\n' "$states" | EXPECTED="$expected" awk '
  BEGIN { n = split(ENVIRON["EXPECTED"], services, "\n") }
  NF { state[$1] = $2; health[$1] = $3 }
  END {
    for (i = 1; i <= n; i++) {
      s = services[i]
      if (!(s in state)) { printf "%s  missing\n", s > "/dev/stderr"; bad = 1; continue }
      if (state[s] != "running") { printf "%s  %s\n", s, state[s] > "/dev/stderr"; bad = 1; continue }
      h = health[s]
      if (h != "" && h != "healthy") { printf "%s  %s\n", s, h > "/dev/stderr"; bad = 1; continue }
      printf "%s  %s\n", s, (h == "" ? "running" : h)
    }
    if (bad) exit 1
  }
'; then
  echo "Infrastructure is not healthy" >&2
  exit 1
fi

echo "Infrastructure is healthy"
