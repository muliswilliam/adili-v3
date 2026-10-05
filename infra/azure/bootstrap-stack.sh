#!/bin/sh
# Run on the Azure VM after the repo is at /opt/adili (or set ADILI_ROOT).
# Starts the existing compose stack with the public Keycloak / app URLs from cloud-init.
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
PUBLIC_ENV="${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
COMPOSE="$ROOT/infra/compose/docker-compose.yml"
OVERLAY="$ROOT/infra/compose/docker-compose.azure.yml"

if [ ! -f "$PUBLIC_ENV" ]; then
  echo "Missing $PUBLIC_ENV. Did cloud-init finish?" >&2
  exit 1
fi
if [ ! -f "$COMPOSE" ]; then
  echo "Missing $COMPOSE. Clone or rsync adili-v3 to $ROOT first." >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  install -o root -g root -m 755 "$ROOT/infra/azure/adili-demo-root.sh" /usr/local/sbin/adili-demo-root
  install -o root -g root -m 440 "$ROOT/infra/azure/sudoers" /etc/sudoers.d/adili-demo
fi

# shellcheck disable=SC1090
. "$PUBLIC_ENV"

export KC_HOSTNAME ADILI_CONSOLE_URL ADILI_PORTAL_URL
# shellcheck disable=SC1091
. "$ROOT/infra/azure/demo-vault.sh"
adili_require_demo_vault
python3 "$ROOT/infra/azure/patch-realm.py" "$ROOT/infra/compose/keycloak/adili-realm.json"

echo "Starting compose (Keycloak image builds on first run; several minutes)."
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d --wait postgres valkey rabbitmq openbao mailpit otel-collector
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d --wait keycloak temporal temporal-ui seaweedfs gotenberg clamav || true
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d

echo "Keycloak issuer: $KC_HOSTNAME/realms/adili"
echo "Set APP_URL / OIDC_ISSUER_URL on portal and console to the public URLs in /etc/adili/public.env"
echo "Then from $ROOT: pnpm bootstrap && $ROOT/infra/azure/configure-app-env.sh && pnpm db:migrate && pnpm db:seed"
echo "Apps: sudo cp $ROOT/infra/azure/adili-apps.service /etc/systemd/system/ && sudo systemctl enable --now adili-apps"
