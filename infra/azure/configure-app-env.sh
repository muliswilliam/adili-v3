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

# Like set_env, with the value read from a file (a secret): it never appears in arguments, and
# the .env becomes readable by its owner only.
set_env_from_file() {
  file="$1"
  key="$2"
  source="$3"
  python3 - "$file" "$key" "$source" <<'PY'
import pathlib, sys
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
value = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8").strip()
lines = [line for line in path.read_text(encoding="utf-8").splitlines()
         if not (line.startswith(f"{key}=") or line.startswith(f"#{key}="))]
lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
path.chmod(0o600)
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
# Links to the portal's public pages (open data).
set_env "$ROOT/apps/console/.env" PORTAL_URL "${ADILI_PORTAL_URL}"

# The hackathon demo (#616): synthetic-data banner and one-click role switcher. Keycloak runs
# with ADILI_DEMO_MODE=true (docker-compose.azure.yml) and the same demo-ticket-secret.
# This host's demo ticket secret (demo-vault.sh), read from its file so it never appears in
# arguments or logs.
# shellcheck disable=SC1091
. "$ROOT/infra/azure/demo-vault.sh"
adili_require_demo_vault
for app in portal console; do
  set_env "$ROOT/apps/$app/.env" DEMO_MODE true
  set_env_from_file "$ROOT/apps/$app/.env" DEMO_TICKET_SECRET "$ADILI_DEMO_TICKET_SECRET_FILE"
done

set_env "$ROOT/apps/verify/.env" APP_URL "${ADILI_VERIFY_URL}"
set_env "$ROOT/apps/verify/.env" PORT "$verify_port"
set_env "$ROOT/apps/verify/.env" ADILI_DEMO_BIND 1

set_env "$ROOT/services/documents/.env" S3_PUBLIC_ENDPOINT "$s3_public"
# QR codes on issued documents open the public verify app.
set_env "$ROOT/services/documents/.env" VERIFY_BASE_URL "${ADILI_VERIFY_URL}"
# Public open-data releases link their manifest's verify page.
set_env "$ROOT/services/reporting/.env" VERIFY_BASE_URL "${ADILI_VERIFY_URL}"

# The hosted demo runs the real backend (#615), whatever an older .env says: every development
# mock off (each `*_MOCK` setting the app declares), and settings the demo flows need. Mocks stay
# the default for local development and tests (.env.example).
for app in portal console verify; do
  sed -n 's/^  \([A-Z_]*_MOCK\): .*/\1/p' "$ROOT/apps/$app/src/server/env.server.ts" |
    while read -r key; do
      set_env "$ROOT/apps/$app/.env" "$key" false
    done
done
# The console reads the audit trail (#593) from the audit service on this host.
set_env "$ROOT/apps/console/.env" AUDIT_API_URL http://localhost:4011
# Reminders at midday sharp, so a seeded reminder lands when the demo script says.
set_env "$ROOT/services/declarations/.env" REMINDER_JITTER_HOURS 0
# The demo Commissions (packages/demo-seed) hold synthetic data only, so the copilot may use the
# external provider.
set_env "$ROOT/services/review/.env" AI_SYNTHETIC_DATA_TENANTS "${ADILI_DEMO_TENANTS:-psc,tsc,eacc,jsc,npsc}"
# `pnpm demo:seed` onboards every officer from this host's one IP and checks every filing against
# the registries (packages/demo-seed/README.md): onboarding and registry limits lifted for it.
# Roster limits and the rest stay at their defaults.
set_env "$ROOT/services/directory/.env" RATE_LIMITS \
  "roster-write=120/60s,roster-read=600/60s,onboarding-identify=100000/60s,onboarding-identify-commission=100000/60s,onboarding-session=100000/60s,onboarding-commissions=60/60s"
set_env "$ROOT/services/directory/.env" ONBOARDING_ABUSE_THRESHOLD 1000000
set_env "$ROOT/mocks/.env" MOCK_REGISTRY_RATE_LIMIT 100000
for registry in KRA NTSA BRS ARDHISASA HR_SUPPLIERS; do
  set_env "$ROOT/services/integration-gateway/.env" "${registry}_RATE_LIMIT_PER_MINUTE" 100000
done
# The AI provider: Anthropic with the key from the VM's secrets file, or the last `pnpm demo:ai`
# choice; replay with a warning when there is no key. The key is never printed.
node "$ROOT/scripts/demo-ai.mjs"

echo "App URLs: portal=${ADILI_PORTAL_URL} console=${ADILI_CONSOLE_URL} issuer=${issuer}"
