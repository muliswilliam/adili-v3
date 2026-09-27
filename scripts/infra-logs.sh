#!/bin/sh
set -eu
# shellcheck source=SCRIPTDIR/lib/compose.sh
. "$(dirname "$0")/lib/compose.sh"
compose logs -f "$@"
