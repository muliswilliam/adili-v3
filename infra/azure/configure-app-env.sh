#!/bin/sh
# Points copied .env files at the public URLs in /etc/adili/public.env.
# Run on the VM after `pnpm bootstrap` (which creates .env from .env.example).
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
PUBLIC_ENV="${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"

# shellcheck disable=SC1090
. "$PUBLIC_ENV"

issuer="${KC_HOSTNAME%/}/realms/adili"
if [ "${ADILI_TLS:-}" = "1" ] || [ "${ADILI_TLS:-}" = "true" ]; then
  portal_port=13010
  console_port=13020
  verify_port=13030
  proxy_hops=1
  s3_public="https://${ADILI_PUBLIC_BASE}:8333"
else
  portal_port=3010
  console_port=3020
  verify_port=3030
  proxy_hops=0
  s3_public="http://${ADILI_PUBLIC_BASE}:8333"
fi

set_env() {
  file="$1"
  key="$2"
  value="$3"
  python3 - "$file" "$key" "$value" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
key, value = sys.argv[2], sys.argv[3]
if not path.exists():
    raise SystemExit(f"missing {path}")
lines = path.read_text(encoding="utf-8").splitlines()
found = False
out = []
for line in lines:
    if line.startswith(f"{key}=") or line.startswith(f"#{key}="):
        out.append(f"{key}={value}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
}

set_env "$ROOT/apps/portal/.env" APP_URL "${ADILI_PORTAL_URL}"
set_env "$ROOT/apps/portal/.env" OIDC_ISSUER_URL "$issuer"
set_env "$ROOT/apps/portal/.env" PORT "$portal_port"
set_env "$ROOT/apps/portal/.env" TRUSTED_PROXY_HOPS "$proxy_hops"
set_env "$ROOT/apps/portal/.env" ADILI_DEMO_BIND 1

set_env "$ROOT/apps/console/.env" APP_URL "${ADILI_CONSOLE_URL}"
set_env "$ROOT/apps/console/.env" OIDC_ISSUER_URL "$issuer"
set_env "$ROOT/apps/console/.env" PORT "$console_port"
set_env "$ROOT/apps/console/.env" ADILI_DEMO_BIND 1

set_env "$ROOT/apps/verify/.env" APP_URL "${ADILI_VERIFY_URL}"
set_env "$ROOT/apps/verify/.env" PORT "$verify_port"
set_env "$ROOT/apps/verify/.env" ADILI_DEMO_BIND 1

set_env "$ROOT/services/documents/.env" S3_PUBLIC_ENDPOINT "$s3_public"
# QR codes on issued documents open the public verify app.
set_env "$ROOT/services/documents/.env" VERIFY_BASE_URL "${ADILI_VERIFY_URL}"

echo "App URLs: portal=${ADILI_PORTAL_URL} console=${ADILI_CONSOLE_URL} issuer=${issuer}"
