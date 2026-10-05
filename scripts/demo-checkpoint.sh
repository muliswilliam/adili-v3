#!/bin/sh
# Demo checkpoints (#621): a whole-stack snapshot taken once, restored in about a minute, so any
# demo beat can start cold.
#
#   scripts/demo-checkpoint.sh capture <name>     snapshot the running stack as <name>
#   scripts/demo-checkpoint.sh restore <name>     put the stack back to <name> (apps stopped)
#   scripts/demo-checkpoint.sh exists <name>      exit 0 when <name> is complete
#   scripts/demo-checkpoint.sh list
#   scripts/demo-checkpoint.sh delete <name>
#
# A checkpoint is every demo database (infra/azure/demo-databases.sh: the services', Keycloak's,
# the mocks' and Temporal's) as a Postgres copy kept next to it, plus the stateful volumes
# (SeaweedFS objects, OpenBao keys, RabbitMQ queues, Mailpit's inbox) copied into the
# demo-checkpoints volume. Capture freezes the whole stack for the few seconds the copies take
# (databases closed to connections, containers paused), so the parts agree with each other.
# Restore stops the containers that cache state (Temporal, Keycloak, OpenBao, SeaweedFS,
# RabbitMQ, Mailpit), swaps the copies in and starts them again; Valkey (sessions, caches) is
# emptied. Temporal's history comes back with its database: workflows started after the
# checkpoint are gone, and the ones running at the checkpoint run again from where they were.
#
# Restore needs the services and apps stopped, so no process keeps state from after the
# checkpoint (Temporal workers cache workflow state): locally stop `pnpm dev` first; on the Azure
# host `pnpm demo:reset` restarts the apps around it (infra/azure/demo-reset.sh).
#
# Compose: the local file, plus ADILI_COMPOSE_OVERLAY when set (the Azure host's overlay);
# COMPOSE_PROJECT_NAME picks another project (tests use an isolated one).
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
# shellcheck source=SCRIPTDIR/lib/compose.sh
. "$ROOT/scripts/lib/compose.sh"
# shellcheck source=SCRIPTDIR/../infra/azure/demo-databases.sh
. "$ROOT/infra/azure/demo-databases.sh"

# On the Azure host, compose runs with its overlay and the host's settings (deploy.sh does the same).
if [ -z "${ADILI_COMPOSE_OVERLAY:-}" ] && [ -f "${ADILI_PUBLIC_ENV:-/etc/adili/public.env}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
  set +a
  # shellcheck source=SCRIPTDIR/../infra/azure/demo-vault.sh
  . "$ROOT/infra/azure/demo-vault.sh"
  ADILI_COMPOSE_OVERLAY="$ROOT/infra/compose/docker-compose.azure.yml"
fi

compose() {
  if [ -n "${ADILI_COMPOSE_OVERLAY:-}" ]; then
    # shellcheck disable=SC2046
    $(compose_bin) -f "$ROOT/infra/compose/docker-compose.yml" -f "$ADILI_COMPOSE_OVERLAY" "$@"
  else
    # shellcheck disable=SC2046
    $(compose_bin) -f "$ROOT/infra/compose/docker-compose.yml" "$@"
  fi
}

# The container engine under compose (docker or podman), for what compose cannot do reliably:
# `compose unpause` skips paused containers on Podman, and health is read per container.
engine() {
  # shellcheck disable=SC2046
  set -- $(compose_bin | cut -d' ' -f1) "$@"
  "$@"
}

containers() {
  compose ps -a -q "$@" 2>/dev/null
}

pause() {
  # shellcheck disable=SC2046
  engine pause $(containers "$@") >/dev/null
}

unpause() {
  # shellcheck disable=SC2046
  engine unpause $(containers "$@") >/dev/null 2>&1 || true
}

# Containers whose state is on a volume the checkpoint copies, and that cache it while running.
VOLUME_SERVICES='seaweedfs openbao rabbitmq mailpit'
# Restore stops these first (Temporal before its database goes, Keycloak's caches) and starts
# them again in this order.
RESTART_SERVICES='openbao seaweedfs rabbitmq mailpit keycloak temporal temporal-ui'
# What runs on the host and must be stopped before a restore (scripts/health.mjs's ports).
HOST_PORTS='4001 4002 4003 4004 4005 4006 4007 4008 4009 4010 4011 8000 3010 3020 3030'

usage() {
  echo "usage: $0 capture|restore|exists|delete <name> | list" >&2
  exit 2
}

log() {
  printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"
}

check_name() {
  case "$1" in
    '' | *[!a-z0-9-]* | -*) echo "Checkpoint names are lowercase letters, digits and -: $1" >&2 && exit 2 ;;
  esac
  if [ "${#1}" -gt 20 ]; then
    echo "Checkpoint names are at most 20 characters: $1" >&2
    exit 2
  fi
}

# Postgres names: ckpt__<name>__<db>, with - as _ (63 characters at most: 6 + 20 + 2 + 25).
copy_name() {
  printf 'ckpt__%s__%s' "$(printf '%s' "$1" | tr '-' '_')" "$2"
}

psql_q() {
  compose exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc "$1"
}

# Runs SQL from stdin statement by statement (CREATE and DROP DATABASE refuse a transaction), in
# one session: each `compose exec` costs a fraction of a second, a freeze should not.
psql_script() {
  compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -At -f - >/dev/null
}

db_exists() {
  [ "$(psql_q "SELECT 1 FROM pg_database WHERE datname = '$1'")" = 1 ]
}

running_services() {
  compose ps --status running --services 2>/dev/null
}

# The demo databases this stack has (an isolated test stack may lack some).
present_databases() {
  for db in $(demo_databases); do
    if db_exists "$db"; then printf '%s\n' "$db"; fi
  done
}

# Runs a shell command in a throwaway container with the checkpoint and data volumes mounted.
volumes_sh() {
  errors="$(mktemp)"
  if ! compose --profile demo-tools run --rm --no-deps -T demo-checkpoint "$1" 2>"$errors"; then
    grep -v -e ' Creating *$' -e ' Created *$' "$errors" >&2
    rm -f "$errors"
    return 1
  fi
  rm -f "$errors"
}

# Closes the databases to new connections and ends the open ones.
close_databases() {
  for db in $1; do
    printf 'ALTER DATABASE "%s" ALLOW_CONNECTIONS false;\n' "$db"
  done | psql_script
  for db in $1; do
    printf "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s';\n" "$db"
  done | psql_script
}

open_databases() {
  for db in $1; do
    printf 'ALTER DATABASE "%s" ALLOW_CONNECTIONS true;\n' "$db"
  done | psql_script || true
}

capture() {
  name="$1"
  started=$(date +%s)
  dbs="$(present_databases)"
  if [ -z "$dbs" ]; then
    echo "No demo databases found. Is the stack up (pnpm infra:up)?" >&2
    exit 1
  fi
  paused=''
  for service in $VOLUME_SERVICES; do
    if running_services | grep -qx "$service"; then paused="$paused $service"; fi
  done

  # Whatever happens, the stack is unfrozen again.
  # shellcheck disable=SC2064
  trap "open_databases '$(echo "$dbs" | tr '\n' ' ')'; [ -z '$paused' ] || unpause $paused" EXIT INT TERM

  log "Freezing the stack: $(echo "$dbs" | wc -l | tr -d ' ') databases${paused:+, paused$paused}"
  close_databases "$dbs"
  # shellcheck disable=SC2086
  [ -z "$paused" ] || pause $paused

  for db in $dbs; do
    printf 'DROP DATABASE IF EXISTS "ckpt_tmp__%s";\n' "$db"
    printf 'CREATE DATABASE "ckpt_tmp__%s" TEMPLATE "%s" STRATEGY FILE_COPY ALLOW_CONNECTIONS false;\n' "$db" "$db"
  done | psql_script
  log 'Databases copied'
  volumes_sh "
    set -eu
    rm -rf /checkpoints/.tmp
    mkdir -p /checkpoints/.tmp
    for volume in $VOLUME_SERVICES; do cp -a /volumes/\$volume /checkpoints/.tmp/\$volume; done
  "
  log 'Volumes copied'

  open_databases "$dbs"
  # shellcheck disable=SC2086
  [ -z "$paused" ] || unpause $paused
  trap - EXIT INT TERM
  log "Stack running again after $(($(date +%s) - started))s"

  # Swap the copies in under the checkpoint's name, replacing an older capture.
  delete_quietly "$name"
  for db in $dbs; do
    printf 'ALTER DATABASE "ckpt_tmp__%s" RENAME TO "%s";\n' "$db" "$(copy_name "$name" "$db")"
  done | psql_script
  revision="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  volumes_sh "
    set -eu
    printf '%s\n' 'name=$name' 'captured=$(date -u +%Y-%m-%dT%H:%M:%SZ)' 'revision=$revision' \
      'databases=$(echo "$dbs" | tr '\n' ' ')' >/checkpoints/.tmp/manifest
    rm -rf '/checkpoints/$name'
    mv /checkpoints/.tmp '/checkpoints/$name'
  "
  log "Captured $name in $(($(date +%s) - started))s"
}

# Every database and the volume copy are there.
checkpoint_complete() {
  name="$1"
  volumes_sh "test -f '/checkpoints/$name/manifest'" 2>/dev/null || return 1
  for db in $(volumes_sh "sed -n 's/^databases=//p' '/checkpoints/$name/manifest'"); do
    db_exists "$(copy_name "$name" "$db")" || return 1
  done
}

restore() {
  name="$1"
  started=$(date +%s)
  if ! checkpoint_complete "$name"; then
    echo "No complete checkpoint $name. Captured: $(list_names | tr '\n' ' ')" >&2
    exit 1
  fi
  if [ "${ADILI_RESTORE_RUNNING_APPS:-}" != yes ]; then
    busy="$(busy_host_ports)"
    if [ -n "$busy" ]; then
      echo "Services or apps are still running (ports$busy). Stop pnpm dev first; a restore" >&2
      echo "under running workers would leave them holding state from after the checkpoint." >&2
      exit 1
    fi
  fi

  stopped=''
  for service in $RESTART_SERVICES; do
    if running_services | grep -qx "$service"; then stopped="$stopped $service"; fi
  done
  log "Stopping$stopped"
  # shellcheck disable=SC2086
  [ -z "$stopped" ] || compose stop -t 3 $stopped >/dev/null 2>&1

  dbs="$(volumes_sh "sed -n 's/^databases=//p' '/checkpoints/$name/manifest'")"
  # Databases whose grants are Postgres's default (Temporal's); init-databases.sh makes the
  # others owner-only, and a copy starts with the default.
  public="$(psql_q "SELECT string_agg(datname, ' ') FROM pg_database WHERE datacl IS NULL")"
  for db in $dbs; do
    printf 'DROP DATABASE IF EXISTS "%s" WITH (FORCE);\n' "$db"
    printf 'CREATE DATABASE "%s" OWNER "%s" TEMPLATE "%s" STRATEGY FILE_COPY;\n' \
      "$db" "$(demo_database_owner "$db")" "$(copy_name "$name" "$db")"
    case " $public " in
      *" $db "*) ;;
      *) printf 'REVOKE ALL ON DATABASE "%s" FROM PUBLIC;\n' "$db" ;;
    esac
  done | psql_script
  log 'Databases restored'

  volumes_sh "
    set -eu
    for volume in $VOLUME_SERVICES; do
      find /volumes/\$volume -mindepth 1 -maxdepth 1 -exec rm -rf {} +
      cp -a '/checkpoints/$name/'\$volume/. /volumes/\$volume/
    done
  "
  log 'Volumes restored'

  if running_services | grep -qx valkey; then
    compose exec -T valkey valkey-cli FLUSHALL >/dev/null
    log 'Valkey emptied (sessions, caches)'
  fi

  # shellcheck disable=SC2086
  [ -z "$stopped" ] || compose start $stopped >/dev/null 2>&1
  # shellcheck disable=SC2086
  [ -z "$stopped" ] || wait_healthy $stopped
  log "Restored $name in $(($(date +%s) - started))s"
}

# Ports scripts/health.mjs checks that something on this host still listens on.
busy_host_ports() {
  # shellcheck disable=SC2016 # JavaScript, not shell
  PORTS="$HOST_PORTS" node -e '
    const net = require("node:net");
    const ports = process.env.PORTS.split(" ").map(Number);
    Promise.all(ports.map((port) => new Promise((done) => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.setTimeout(500);
      socket.on("connect", () => { socket.destroy(); done(port); });
      socket.on("error", () => done(null));
      socket.on("timeout", () => { socket.destroy(); done(null); });
    }))).then((open) => {
      const busy = open.filter(Boolean);
      if (busy.length) process.stdout.write(" " + busy.join(" "));
    });
  '
}

# Waits until each container is healthy (or running, without a healthcheck); 3 minutes at most.
wait_healthy() {
  deadline=$(($(date +%s) + 180))
  for service in "$@"; do
    while :; do
      id="$(containers "$service" | head -n 1)"
      state="$(engine inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
      case "$state" in
        healthy | running) break ;;
      esac
      if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "$service is not healthy after a restore ($state)" >&2
        exit 1
      fi
      sleep 1
    done
  done
}

list_names() {
  # shellcheck disable=SC2016 # expanded in the container
  volumes_sh 'for m in /checkpoints/*/manifest; do [ -f "$m" ] && sed -n "s/^name=//p" "$m"; done; true'
}

list() {
  # shellcheck disable=SC2016 # expanded in the container
  volumes_sh '
    for m in /checkpoints/*/manifest; do
      [ -f "$m" ] || continue
      printf "%-20s %s  %s\n" "$(sed -n "s/^name=//p" "$m")" "$(sed -n "s/^captured=//p" "$m")" \
        "$(sed -n "s/^revision=//p" "$m")"
    done
  '
}

delete_quietly() {
  name="$1"
  prefix="$(copy_name "$name" '')"
  for db in $(psql_q "SELECT datname FROM pg_database WHERE starts_with(datname, '$prefix')"); do
    printf 'DROP DATABASE "%s";\n' "$db"
  done | psql_script
  volumes_sh "rm -rf '/checkpoints/$name'"
}

cmd="${1:-}"
case "$cmd" in
  capture | restore | exists | delete)
    [ $# -eq 2 ] || usage
    check_name "$2"
    case "$cmd" in
      capture) capture "$2" ;;
      restore) restore "$2" ;;
      exists) checkpoint_complete "$2" ;;
      delete) delete_quietly "$2" && log "Deleted $2" ;;
    esac
    ;;
  list) list ;;
  *) usage ;;
esac
