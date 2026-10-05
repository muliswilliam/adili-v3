#!/usr/bin/env bash
# adili-apps' ExecStart: the services and mocks from source (`turbo dev`, as locally), and portal,
# console and verify from their production builds (#371). Vite's dev server sends the browser
# hundreds of unbundled modules, which over the network delays hydration (the demo switcher, the
# theme) by seconds; the production server sends a few bundled chunks. deploy.sh builds the apps;
# a missing build (a host set up by hand) is built here first. Each server reads its .env.
# Any process ending fails the unit, so systemd restarts the lot.
set -euo pipefail

ROOT="${ADILI_ROOT:-/opt/adili}"
cd "$ROOT"

APPS=(portal console verify)
app_filters=()
dev_filters=()
missing=()
for app in "${APPS[@]}"; do
  app_filters+=("--filter=@adili/$app")
  dev_filters+=("--filter=!@adili/$app")
  [ -f "apps/$app/.output/server/index.mjs" ] || missing+=("--filter=@adili/$app")
done
if [ "${#missing[@]}" -gt 0 ]; then
  pnpm exec turbo run build "${missing[@]}" --output-logs=errors-only
fi

pnpm exec turbo run dev --concurrency=64 "${dev_filters[@]}" &
pnpm exec turbo run start "${app_filters[@]}" &
wait -n
exit 1
