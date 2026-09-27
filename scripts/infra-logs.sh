#!/bin/sh
set -eu
# shellcheck source=lib/compose.sh
. "$(dirname "$0")/lib/compose.sh"
compose logs -f "$@"
