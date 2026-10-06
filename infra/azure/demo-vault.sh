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
# Keycloak's master admin password on this host, random, set by keycloak-admin-password.mjs in
# place of the bootstrap admin_dev. Outside the vault: Keycloak itself never reads it.
ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE="$ADILI_SECRETS_DIR/keycloak-admin-password"
export ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE
# Real email for the end-to-end test accounts (docs/demo-accounts.md): the SMTP provider's
# settings, written by the deploy workflow from the repo's SMTP_* secrets, and the Mailpit relay
# settings made from them (adili_prepare_mail_relay), which docker-compose.azure.yml gives Mailpit.
ADILI_SMTP_ENV="$ADILI_SECRETS_DIR/smtp.env"
ADILI_MAILPIT_RELAY_ENV="$ADILI_SECRETS_DIR/mailpit-relay.env"
export ADILI_SMTP_ENV ADILI_MAILPIT_RELAY_ENV

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
    if [ ! -s "$ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE" ]; then
      head -c 36 /dev/urandom | base64 | tr -d '\n/+=' >"$ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE.tmp"
      mv "$ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE.tmp" "$ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE"
      echo "Created this host's Keycloak admin password in $ADILI_SECRETS_DIR"
    fi
    if [ ! -s "$ADILI_DEMO_TICKET_SECRET_FILE" ]; then
      head -c 48 /dev/urandom | base64 | tr -d '\n/+=' >"$ADILI_DEMO_TICKET_SECRET_FILE.tmp"
      mv "$ADILI_DEMO_TICKET_SECRET_FILE.tmp" "$ADILI_DEMO_TICKET_SECRET_FILE"
      echo "Created this host's demo ticket secret in $ADILI_KEYCLOAK_VAULT"
    fi
  )
  adili_prepare_mail_relay
}

# One setting from the SMTP settings file, or nothing. Never printed by the callers that read
# the password.
adili_smtp_setting() {
  [ -f "$ADILI_SMTP_ENV" ] || return 0
  sed -n "s/^$1=//p" "$ADILI_SMTP_ENV" | tail -n 1
}

# The domain whose addresses get real email: E2E_EMAIL_DOMAIN, else the sender's (SMTP_FROM).
# Empty when the host has no SMTP settings.
adili_e2e_email_domain() {
  domain="$(adili_smtp_setting E2E_EMAIL_DOMAIN)"
  if [ -z "$domain" ]; then
    domain="$(adili_smtp_setting SMTP_FROM | sed -n 's/.*@\([^>[:space:]]*\).*/\1/p')"
  fi
  printf '%s\n' "$domain" | tr '[:upper:]' '[:lower:]'
}

# Writes Mailpit's relay settings (#371 end-to-end accounts). Everything the stack sends still goes
# to Mailpit; Mailpit relays a copy of what is addressed to the e2e domain, and only that, through
# the SMTP provider (STARTTLS, password auth), from SMTP_FROM. Mail to every other address (the
# synthetic officers' *.go.ke ones) stays in Mailpit, so the seed and the demo inbox work as before
# and no real address ever gets demo mail. Without SMTP settings the file is empty: no relay.
adili_prepare_mail_relay() {
  (
    umask 077
    tmp="$ADILI_MAILPIT_RELAY_ENV.tmp"
    : >"$tmp"
    host="$(adili_smtp_setting SMTP_HOST)"
    if [ -n "$host" ]; then
      domain="$(adili_e2e_email_domain)"
      case "$domain" in
        '' | *[!a-z0-9.-]* | .* | *. | *..*)
          echo "SMTP settings: no valid e2e email domain (E2E_EMAIL_DOMAIN or SMTP_FROM's); Mailpit relays nothing." >&2
          domain=''
          ;;
      esac
    fi
    if [ -n "$host" ] && [ -n "$domain" ]; then
      port="$(adili_smtp_setting SMTP_PORT)"
      recipients="(?i)@$(printf '%s' "$domain" | sed 's/\./\\./g')\$"
      # Compose reads single-quoted values literally; a value with a quote or a newline cannot be.
      for pair in \
        "MP_SMTP_RELAY_HOST=$host" \
        "MP_SMTP_RELAY_PORT=${port:-587}" \
        "MP_SMTP_RELAY_STARTTLS=true" \
        "MP_SMTP_RELAY_AUTH=plain" \
        "MP_SMTP_RELAY_USERNAME=$(adili_smtp_setting SMTP_USER)" \
        "MP_SMTP_RELAY_PASSWORD=$(adili_smtp_setting SMTP_PASSWORD)" \
        "MP_SMTP_RELAY_OVERRIDE_FROM=$(adili_smtp_setting SMTP_FROM)" \
        "MP_SMTP_RELAY_MATCHING=$recipients" \
        "MP_SMTP_RELAY_ALLOWED_RECIPIENTS=$recipients"; do
        case "$pair" in
          *"'"*)
            echo "SMTP settings: ${pair%%=*} holds a quote; Mailpit relays nothing." >&2
            : >"$tmp"
            break
            ;;
        esac
        printf "%s='%s'\n" "${pair%%=*}" "${pair#*=}" >>"$tmp"
      done
    fi
    mv "$tmp" "$ADILI_MAILPIT_RELAY_ENV"
    if [ -s "$ADILI_MAILPIT_RELAY_ENV" ]; then
      echo "Mailpit relays mail to @$domain through $host"
    fi
  )
}

# Fails unless deploy.sh has created the vault and the admin password: without the vault Keycloak
# would start with none.
adili_require_demo_vault() {
  for secret in "$ADILI_DEMO_TICKET_SECRET_FILE" "$ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE"; do
    if [ ! -s "$secret" ]; then
      echo "Missing $secret. Run infra/azure/deploy.sh as adili first." >&2
      exit 1
    fi
  done
  # Mailpit's relay settings: empty without SMTP settings, but compose needs the file.
  if [ ! -f "$ADILI_MAILPIT_RELAY_ENV" ]; then
    echo "Missing $ADILI_MAILPIT_RELAY_ENV. Run infra/azure/deploy.sh as adili first." >&2
    exit 1
  fi
}
