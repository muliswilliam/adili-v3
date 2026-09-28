#!/bin/sh
# Starts local infrastructure and waits until it is usable on Docker or Podman.
# `compose up --wait` treats finished one-shot init jobs as failures, so they run separately.
# Database roles are applied again after Postgres is up so new services appear on an existing volume.
set -eu

# shellcheck source=SCRIPTDIR/lib/compose.sh
. "$(dirname "$0")/lib/compose.sh"

init_jobs=$(compose_services init)
long_running=$(compose_services long-running)

# Pull registry images that are not cached yet. adili/keycloak:dev is built locally, so it is
# skipped here and `up --pull never` builds it instead of failing on a Hub lookup.
# shellcheck disable=SC2086
compose pull --policy missing --ignore-buildable $long_running
# shellcheck disable=SC2086
compose up -d --wait --pull never $long_running

# Re-apply roles and databases. The script is idempotent; initdb.d only runs on an empty volume.
compose exec -T postgres /bin/sh /docker-entrypoint-initdb.d/10-init-databases.sh

# shellcheck disable=SC2086
compose up --no-log-prefix $init_jobs
for job in $init_jobs; do
  code=$(compose ps -a --format '{{.ExitCode}}' "$job")
  if [ "$code" != 0 ]; then
    echo "Init job ${job} failed with exit code ${code}" >&2
    exit 1
  fi
done

echo 'Infrastructure is ready'
compose ps
