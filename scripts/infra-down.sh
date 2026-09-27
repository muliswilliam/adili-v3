#!/bin/sh
# Stops local infrastructure. Pass --volumes (or INFRA_DOWN_VOLUMES=1) to delete data.
set -eu

# shellcheck source=SCRIPTDIR/lib/compose.sh
. "$(dirname "$0")/lib/compose.sh"

volumes=0
for arg in "$@"; do
  case "$arg" in
    --volumes | -v) volumes=1 ;;
    --help | -h)
      echo "Usage: $0 [--volumes]"
      echo "  --volumes   also remove named volumes (same as pnpm infra:reset)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [ "${INFRA_DOWN_VOLUMES:-}" = 1 ]; then
  volumes=1
fi

if [ "$volumes" -eq 1 ]; then
  compose down --volumes --remove-orphans
else
  compose down --remove-orphans
fi
