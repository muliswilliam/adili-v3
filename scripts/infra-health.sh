#!/bin/sh
# Fails unless every long-running compose service is running and healthy.
set -eu

# shellcheck source=lib/compose.sh
. "$(dirname "$0")/lib/compose.sh"

if ! compose ps --format '{{.Service}} {{.State}} {{.Health}}' | awk '
  $1 == "temporal-schema" || $1 == "temporal-namespace" || $1 == "seaweedfs-buckets" { next }
  {
    health = $3
    if ($2 != "running") { printf "%s  %s\n", $1, $2 > "/dev/stderr"; bad = 1; next }
    if (health != "" && health != "healthy") { printf "%s  %s\n", $1, health > "/dev/stderr"; bad = 1; next }
    printf "%s  %s\n", $1, (health == "" ? "running" : health)
  }
  END { if (bad) exit 1 }
'; then
  echo "Infrastructure is not healthy" >&2
  exit 1
fi

echo "Infrastructure is healthy"
