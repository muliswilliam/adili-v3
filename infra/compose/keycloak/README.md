# Adili realm

`adili-realm.json` is the source of truth for the `adili` Keycloak realm. Compose mounts it at `/opt/keycloak/data/import` and `start-dev --import-realm` loads it when the realm is not already in Postgres.

Re-running `pnpm infra:up` is idempotent: Keycloak skips the import if `adili` exists. After changing this file, recreate the realm (`pnpm infra:reset` or delete `adili` in the admin console) and start the stack again.

Demo users in the file are a local convenience. #371 can replace them with seed data; the realm does not depend on them.

## Flows (specs 03, 04, 06)

| Flow | What it does |
| --- | --- |
| `adili browser` | Cookie, broker, then forms |
| `adili password` | Username/password at LoA 1 (stays valid for the SSO session) |
| `adili otp` | LoA 2, max age 300 seconds. A step-up request with `acr_values=step-up` re-runs only this |
| `adili declarant otp` | Role `declarant`. Empty of authenticators until #79 |
| `adili applicant otp` | Role `applicant`. Same plug-in point as declarants |
| `adili staff totp` | Everyone else (staff and law-enforcement). Built-in TOTP form |

ACR mapping: `step-up` → 2. Portal and console default ACR is `step-up`, so login is MFA.

## Plug-in for #79 (Adili OTP authenticator)

Add a REQUIRED execution with provider id `adili-otp` to `adili declarant otp` and `adili applicant otp`. Do not add it to the staff TOTP flow. The authenticator must honour LoA so a step-up request re-runs only the OTP (spec 06 S16).

Passkeys are enabled as an optional required action (`webauthn-register`). They are not on the browser flow.
