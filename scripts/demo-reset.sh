#!/bin/sh
# `pnpm demo:reset <checkpoint>` (#621): puts the demo stack back to a checkpoint.
# On the Azure host the apps restart around the restore (infra/azure/demo-reset.sh); locally,
# stop `pnpm dev` first, run this, then start `pnpm dev` again.
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"

if [ -x "${ADILI_ROOT_HELPER:-/usr/local/sbin/adili-demo-root}" ] &&
  [ -f "${ADILI_PUBLIC_ENV:-/etc/adili/public.env}" ]; then
  exec "$ROOT/infra/azure/demo-reset.sh" "$@"
fi
exec "$ROOT/scripts/demo-checkpoint.sh" restore "$@"
