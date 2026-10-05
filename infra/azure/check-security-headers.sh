#!/bin/sh
# Confirm portal, console and verify send CSP framing rules, HSTS and X-Frame-Options.
# The hosted demo serves portal on 443, console on 3020 and verify on 3030.
#
#   ./infra/azure/check-security-headers.sh https://adili-demo.southafricanorth.cloudapp.azure.com
set -eu

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "Usage: $0 https://<demo-host>" >&2
  exit 1
fi
BASE="${BASE%/}"

fail=0

header_value() {
  printf '%s\n' "$headers" | tr -d '\r' | awk -v name="$1" '
    tolower($0) ~ "^" name ":" {
      sub(/^[^:]+:[[:space:]]*/, "")
      print
      exit
    }
  '
}

check() {
  name="$1"
  url="$2"
  echo "Checking $name ($url)"
  headers="$(curl -fsS -D - -o /dev/null --max-time 20 "$url")" || {
    echo "$name: request failed" >&2
    fail=1
    return
  }
  csp="$(header_value content-security-policy)"
  hsts="$(header_value strict-transport-security)"
  frame="$(header_value x-frame-options)"
  case "$csp" in
    *frame-ancestors*none*) ;;
    *)
      echo "$name: content-security-policy is missing frame-ancestors 'none'" >&2
      fail=1
      ;;
  esac
  case "$csp" in
    *style-src-attr*unsafe-inline*) ;;
    *)
      echo "$name: content-security-policy is missing style-src-attr 'unsafe-inline'" >&2
      fail=1
      ;;
  esac
  case "$hsts" in
    *max-age=*) ;;
    *)
      echo "$name: strict-transport-security is missing" >&2
      fail=1
      ;;
  esac
  case "$frame" in
    *DENY*|*deny*) ;;
    *)
      echo "$name: x-frame-options is not DENY" >&2
      fail=1
      ;;
  esac
}

check portal "$BASE/"
check console "$BASE:3020/"
check verify "$BASE:3030/"

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "Security headers ok"
