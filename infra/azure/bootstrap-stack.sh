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

# shellcheck disable=SC1090
. "$PUBLIC_ENV"

export KC_HOSTNAME ADILI_CONSOLE_URL ADILI_PORTAL_URL

python3 - "$ROOT/infra/compose/keycloak/adili-realm.json" <<'PY'
import json, os, sys
path = sys.argv[1]
portal = os.environ["ADILI_PORTAL_URL"].rstrip("/")
console = os.environ["ADILI_CONSOLE_URL"].rstrip("/")
with open(path, encoding="utf-8") as fh:
    realm = json.load(fh)
# HTTP Azure hostname: Keycloak sslRequired=external 403s browsers on a public IP.
realm["sslRequired"] = "none"
for client in realm.get("clients", []):
    cid = client.get("clientId")
    if cid == "portal":
        client["redirectUris"] = [f"{portal}/*"]
        client["webOrigins"] = [portal]
        client.setdefault("attributes", {})["post.logout.redirect.uris"] = f"{portal}/*"
    if cid == "console":
        client["redirectUris"] = [f"{console}/*"]
        client["webOrigins"] = [console]
        client.setdefault("attributes", {})["post.logout.redirect.uris"] = f"{console}/*"
with open(path, "w", encoding="utf-8") as fh:
    json.dump(realm, fh, indent=2)
    fh.write("\n")
print(f"Realm redirects: portal={portal} console={console}")
PY

echo "Starting compose (Keycloak image builds on first run; several minutes)."
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d --wait postgres valkey rabbitmq openbao mailpit otel-collector
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d --wait keycloak temporal temporal-ui seaweedfs gotenberg clamav || true
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d

echo "Keycloak issuer: $KC_HOSTNAME/realms/adili"
echo "Set APP_URL / OIDC_ISSUER_URL on portal and console to the public URLs in /etc/adili/public.env"
echo "Then from $ROOT: pnpm bootstrap && $ROOT/infra/azure/configure-app-env.sh && pnpm db:migrate && pnpm db:seed"
echo "Apps: sudo cp $ROOT/infra/azure/adili-apps.service /etc/systemd/system/ && sudo systemctl enable --now adili-apps"
