#!/bin/sh
# Starts local infrastructure and waits until it is usable.
# `compose up --wait` treats finished one-shot init jobs as failures, so they run separately.
set -eu

compose() {
  docker compose -f "$(dirname "$0")/../infra/compose/docker-compose.yml" "$@"
}

init_jobs="temporal-schema temporal-namespace seaweedfs-buckets openbao-keys"
long_running=$(compose config --services | grep -vxF -e temporal-schema -e temporal-namespace -e seaweedfs-buckets -e openbao-keys)

# shellcheck disable=SC2086
compose up -d --wait $long_running
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
