#!/bin/sh
# Databases that hold demo state. adili_test is scratch for integration tests and is not included.
# shellcheck shell=sh

demo_databases() {
  printf '%s\n' \
    adili_directory \
    adili_declarations \
    adili_review \
    adili_access \
    adili_reporting \
    adili_documents \
    adili_verification \
    adili_ai_gateway \
    adili_integration_gateway \
    adili_notifications \
    adili_audit \
    keycloak \
    mocks \
    temporal \
    temporal_visibility
}

# Role that owns the database. Matches infra/compose/postgres/init-databases.sh.
demo_database_owner() {
  case "$1" in
    temporal_visibility) printf '%s\n' temporal ;;
    *) printf '%s\n' "$1" ;;
  esac
}

# Outside the repo so Azure rsync --delete cannot remove dumps.
adili_backup_root() {
  if [ -n "${ADILI_BACKUP_ROOT:-}" ]; then
    printf '%s\n' "$ADILI_BACKUP_ROOT"
  elif [ -d /opt/adili ]; then
    printf '%s\n' /home/adili/adili-backups
  else
    printf '%s\n' "${HOME:-/tmp}/adili-backups"
  fi
}
