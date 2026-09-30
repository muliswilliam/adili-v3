#!/bin/sh
# Fails unless every long-running compose service is running and healthy, and every init job
# has finished with exit code 0.
set -eu

# shellcheck source=SCRIPTDIR/lib/compose.sh
. "$(dirname "$0")/lib/compose.sh"

# Expected services come from the compose file, so a service that exited or was never
# created is reported as missing instead of silently dropping out of `compose ps`.
long_running=$(compose_services long-running)
init_jobs=$(compose_services init)
states=$(compose ps --all --format '{{.Service}} {{.State}} {{.ExitCode}} {{.Health}}')

if ! printf '%s\n' "$states" | LONG_RUNNING="$long_running" INIT_JOBS="$init_jobs" awk '
  BEGIN {
    n = split(ENVIRON["LONG_RUNNING"], services, "\n")
    m = split(ENVIRON["INIT_JOBS"], jobs, "\n")
  }
  NF { state[$1] = $2; code[$1] = $3; health[$1] = $4 }
  END {
    for (i = 1; i <= n; i++) {
      s = services[i]
      if (!(s in state)) { printf "%s  missing\n", s > "/dev/stderr"; bad = 1; continue }
      if (state[s] != "running") { printf "%s  %s\n", s, state[s] > "/dev/stderr"; bad = 1; continue }
      h = health[s]
      if (h != "" && h != "healthy") { printf "%s  %s\n", s, h > "/dev/stderr"; bad = 1; continue }
      printf "%s  %s\n", s, (h == "" ? "running" : h)
    }
    for (i = 1; i <= m; i++) {
      j = jobs[i]
      if (!(j in state)) { printf "%s  never ran\n", j > "/dev/stderr"; bad = 1; continue }
      if (state[j] != "exited") { printf "%s  %s, not finished\n", j, state[j] > "/dev/stderr"; bad = 1; continue }
      if (code[j] != 0) { printf "%s  exited with code %s\n", j, code[j] > "/dev/stderr"; bad = 1; continue }
      printf "%s  done\n", j
    }
    if (bad) exit 1
  }
'; then
  echo "Infrastructure is not healthy" >&2
  exit 1
fi

echo "Infrastructure is healthy"
