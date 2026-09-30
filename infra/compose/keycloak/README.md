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
| `adili declarant otp` | Role `declarant`. `adili-otp`: a code by SMS, email as fallback |
| `adili applicant otp` | Role `applicant`. `adili-otp`, as for declarants |
| `adili staff totp` | Everyone else (staff and law-enforcement). Built-in TOTP form |

ACR mapping: `step-up` → 2. Portal and console default ACR is `step-up`, so login is MFA.

## Staff provisioning (spec 06)

- `directory` is a confidential client with only a service account. The directory service uses it on the Admin REST API to create staff accounts, grant and revoke roles and send the activation email. Its service account has realm-management `manage-users`, `view-users` and `query-users` (not `view-realm`), plus the client roles below.
- `smtpServer` sends to Mailpit (`mailpit:1025`); execute-actions email fails without it.
- `emailTheme: adili` is the activation email in `apps/keycloak-theme/src/email`, so the stock Keycloak image cannot import this realm. Use `adili/keycloak:dev` (compose builds it; CI builds it in the Keycloak workflow).
- The user profile declares the admin-only attributes `commissionName` and `invitedRole`, which the activation email reads. The unmanaged attribute policy is `ADMIN_VIEW`, so an undeclared attribute cannot be written.
- The login theme reads `ADILI_CONSOLE_URL` (default `http://localhost:3020`) and `ADILI_PORTAL_URL` (default `http://localhost:3010`) from Keycloak's environment. Keycloak renders an expired or already used emailed link without a client, so its page offers sign-in (or a new link) there. Set both to the apps' public origins in every deployment.
- New staff get the required actions `VERIFY_EMAIL`, `UPDATE_PASSWORD` and `CONFIGURE_TOTP`; the activation link completes them in that realm's priority order (TOTP, then password). Their later sign-ins go through `adili staff totp`.

## Declarant accounts (spec 03)

- Onboarding's confirm step creates declarants through the same `directory` client: username = OFR (Keycloak keeps it lower-case; sign-in is case-insensitive), verified email, realm role `declarant`, required action `UPDATE_PASSWORD`, and the admin-only attributes `tenant`, `tenants`, `ofr`, `person_id` and `phone`.
- `tenants` is `multivalued`: a person onboarded with a second Commission gets it added there, while `tenant` (the token claim) stays the first Commission.
- The set-password email is the execute-actions email (24 hours) with `client_id=portal` and `redirect_uri=<portal>/auth/login`, admitted by the portal client's `http://localhost:3010/*` redirect URIs. Without invitation attributes the email theme renders its generic account-setup copy.

## HR-system API clients (spec 27)

- The directory creates one confidential client per Commission's credential (`roster-<slug>-<hex>`) with only a service account, the default client scopes `basic` and `roster:write`, a hard-coded `tenant` claim and the `adili-api` audience. Rotating regenerates the secret; revoking disables the client. For that the `directory` service account also has realm-management `manage-clients`, `view-clients` and `query-clients`.
- `roster:write` is a realm client scope, included in the token's `scope` claim and in no client's defaults except those API clients.
- Listing `clientScopes` in the file replaces Keycloak's built-in scopes, so the file lists them all (as Keycloak 26.7 creates them) plus Adili's own (`roster:write`, `documents:internal`, `messages`, `iprs`), and the realm defaults. `pnpm keycloak:check` fails when a client names a scope the file does not list. Keycloak's own clients (`account`, `account-console`, `admin-cli`, `broker`, `realm-management`, `security-admin-console`) are created before the scopes on import and so get no default scopes; Adili uses none of them (the account console is off, `accountThemeImplementation: 'none'`, and admins use the master realm).

## Service-to-service calls (spec 27)

- The directory calls the documents service's internal API (`/internal/v1/uploads/{id}/download`) with its own client credentials token and the header `X-Acting-Tenant: <slug>` (`ServiceTokenClient` and `ACTING_TENANT_HEADER` in `packages/api-kit`). Documents trusts the header only for tokens with scope `documents:internal`, and answers 404 for uploads of another tenant.
- So the `directory` client has the default client scope `documents:internal` (a realm client scope in the token's `scope` claim) and the `adili-api` audience mapper services verify. Its service account holds no realm roles beyond `default-roles-adili`, so the token passes no role check.

## Adili OTP authenticator (#79)

`adili-otp` comes from `apps/keycloak-extension` (a provider JAR the Keycloak image builds and installs). It is REQUIRED in `adili declarant otp` and `adili applicant otp`, never in the staff TOTP flow. Because it sits in the LoA 2 sub-flow, a step-up request (`acr_values=step-up`) re-runs only the code step (spec 06 S16), and the page says so.

- Rules come from the `adili-otp` authenticator config: code lifetime 600 s, 5 wrong codes, 60 s resend cooldown, 3 new codes. Wrong codes count across new codes. Too many of either returns to the sign-in page with a message.
- Codes go through notifications (`POST /internal/v1/messages`, templates `login-otp-sms` and `login-otp-email`) with a token for the confidential client `keycloak-extension`, whose default scope `messages` adds the `adili-api` audience. `notificationsUrl` and `tokenUrl` are blank in the realm, so `ADILI_NOTIFICATIONS_URL` (compose: the host's port 4010) and `ADILI_OTP_TOKEN_URL` (default: this realm on `http://localhost:8080`) apply.
- The client secret is `${vault.keycloak-extension-secret}`, read from Keycloak's file vault. Compose mounts `vault-dev/` at `/opt/keycloak/vault`: development-only secrets matching the realm file's development client secrets, committed like them for local use and never deployed (ADR-012 keeps real secrets out of the repo). Deployments mount their own `adili_keycloak-extension-secret` file there.
- A send that fails (notifications down, provider refused) shows the send-failed page with the other channel, or "try again" once both have failed. SMS goes to the `phone` attribute, email to the account email.

`messages` and `iprs` are realm client scopes for service-to-service calls, listed with the others above; each adds the `adili-api` audience. `directory` has both.

After pulling a change to the extension or the theme, rebuild the image (`docker compose -f infra/compose/docker-compose.yml build keycloak`) and recreate the realm.

Passkeys are enabled as an optional required action (`webauthn-register`). They are not on the browser flow yet: passkey sign-in is #403.
