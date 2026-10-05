#!/bin/sh
# The Azure demo's Keycloak vault (#616), kept outside the repo tree so the deploy's
# rsync --delete never touches it. Sourced by deploy.sh, configure-app-env.sh,
# bootstrap-stack.sh and enable-https.sh, so every compose run mounts the same vault.
#
# It holds the repo's development entries (ADR-012) except the demo ticket secret, which is
# random per host: that secret signs a demo account in with no password or code, so the
# committed development value must never work on a public host. Created once by deploy.sh (as
# adili); never printed.
# shellcheck shell=sh

ADILI_SECRETS_DIR="${ADILI_SECRETS_DIR:-/home/adili/.config/adili}"
ADILI_KEYCLOAK_VAULT="$ADILI_SECRETS_DIR/keycloak-vault"
ADILI_DEMO_TICKET_SECRET_FILE="$ADILI_KEYCLOAK_VAULT/adili_demo-ticket-secret"
# docker-compose.azure.yml mounts this directory as Keycloak's file vault.
export ADILI_KEYCLOAK_VAULT

# Creates or refreshes the vault. Run as adili, Keycloak's uid in its container (1000): the
# entries are mode 600 and Keycloak reads them through the bind mount.
adili_prepare_demo_vault() {
  repo_vault="$1/infra/compose/keycloak/vault-dev"
  (
    umask 077
    mkdir -p "$ADILI_KEYCLOAK_VAULT"
    chmod 700 "$ADILI_SECRETS_DIR" "$ADILI_KEYCLOAK_VAULT"
    for entry in "$repo_vault"/*; do
      name="$(basename "$entry")"
      [ "$name" = adili_demo-ticket-secret ] && continue
      install -m 600 "$entry" "$ADILI_KEYCLOAK_VAULT/$name"
    done
    if [ ! -s "$ADILI_DEMO_TICKET_SECRET_FILE" ]; then
      head -c 48 /dev/urandom | base64 | tr -d '\n/+=' >"$ADILI_DEMO_TICKET_SECRET_FILE.tmp"
      mv "$ADILI_DEMO_TICKET_SECRET_FILE.tmp" "$ADILI_DEMO_TICKET_SECRET_FILE"
      echo "Created this host's demo ticket secret in $ADILI_KEYCLOAK_VAULT"
    fi
  )
}

# Fails unless deploy.sh has created the vault: without it Keycloak would start with no vault.
adili_require_demo_vault() {
  if [ ! -s "$ADILI_DEMO_TICKET_SECRET_FILE" ]; then
    echo "Missing $ADILI_DEMO_TICKET_SECRET_FILE. Run infra/azure/deploy.sh as adili first." >&2
    exit 1
  fi
}
