# Adili realm

`adili-realm.json` is the source of truth for the `adili` Keycloak realm. Compose mounts it at `/opt/keycloak/data/import` and `start-dev --import-realm` loads it when the realm is not already in Postgres.

Re-running `pnpm infra:up` is idempotent: Keycloak skips the import if `adili` exists. After changing this file, recreate the realm (`pnpm infra:reset` or delete `adili` in the admin console) and start the stack again.

Demo users in the file are a local convenience. #371 can replace them with seed data; the realm does not depend on them.

## Flows (specs 03, 04, 06)

| Flow | What it does |
| --- | --- |
| `adili browser` | Cookie, broker, then forms |
| `adili password` | Username/password at LoA 1 (stays valid for the SSO session) |
| `adili otp` | LoA 2, max age 180 seconds (the 300 s submit window less a 120 s margin, so a silent step-up still leaves time to submit). A step-up request with `acr_values=step-up` re-runs only this |
| `adili declarant otp` | Role `declarant`. `adili-otp`: a code by SMS, email as fallback |
| `adili applicant otp` | Role `applicant`. `adili-otp`, as for declarants |
| `adili staff totp` | Everyone else (staff and law-enforcement). Built-in TOTP form |

ACR mapping: `step-up` → 2. Portal and console default ACR is `step-up`, so login is MFA.

Step-up before submission (spec 06): the portal's `/auth/step-up` (`Bff.stepUp` in `packages/bff-auth`) sends `acr_values=step-up`. Once the code's 180 s have lapsed Keycloak asks for a new code only (the password holds for the session) and issues tokens with `acr` `step-up` and a new `auth_time`; within the 180 s it answers without a page and keeps the old `auth_time`, which the declarations service accepts for 300 s, so every step-up leaves at least 120 s to affirm and submit. The `acr` scope and the `basic` scope's `auth_time` mapper put both claims in ID and access tokens, which services read as `Principal.acr` and `Principal.authTime` (`packages/api-kit`). S16 in `apps/keycloak-extension/test/step-up.stack.test.ts` drives it.

## Person claim (spec 04)

Declarant data is keyed by person, not tenant. The `portal` and `console` clients map the user attribute `person_id` (admin-only in the user profile, set when onboarding links the account to a person) to the `person_id` claim; staff have none, so their tokens are unchanged. Services read it as `Principal.personId` (`packages/api-kit`) and scope declarant transactions with `withPerson` (`packages/data-access`). The demo `declarant` has a fixed `person_id`.

## Staff provisioning (spec 06)

- `directory` is a confidential client with only a service account. The directory service uses it on the Admin REST API to create staff accounts, grant and revoke roles and send the activation email. Its service account has realm-management `manage-users`, `view-users` and `query-users`, plus the client roles below. It also has `view-realm`, to list a role's holders (a Commission's staff by role, #220) in one paged read rather than searching every account at the Commission, declarants included, and reading each one's roles.
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
- Listing `clientScopes` in the file replaces Keycloak's built-in scopes, so the file lists them all (as Keycloak 26.7 creates them) plus Adili's own (`roster:write`, `documents:internal`, `messages`, `iprs`, `directory:internal`, `directory:person-contacts`, `directory:roster-national-id`, `declarations:internal`, `review:internal`, `registry`, `payroll`, `icms`, `ai:internal`), and the realm defaults. `pnpm keycloak:check` fails when a client names a scope the file does not list, and when a service's token client asks for a scope its Keycloak client does not have by default (Keycloak refuses the whole token request for one unknown scope). Keycloak's own clients (`account`, `account-console`, `admin-cli`, `broker`, `realm-management`, `security-admin-console`) are created before the scopes on import and so get no default scopes; Adili uses none of them (the account console is off, `accountThemeImplementation: 'none'`, and admins use the master realm).

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

## Directory internal API (spec 04)

- `directory:internal` is a realm client scope (in the token's `scope` claim, adds the `adili-api` audience) for the directory's `/internal/v1` routes: the Commission reference, roster records by import or exit batch, one record and the current policy (with `X-Acting-Tenant`, as in "Service-to-service calls"), and the list of every Commission (no `X-Acting-Tenant`: public reference data).
- `directory:person-contacts` is a realm client scope of its own (same shape) for a person's verified contacts (`/internal/v1/persons/{personId}/contacts`, with `X-Acting-Tenant`: the person must be onboarded at that tenant). Contacts are personal data, so only the `notifications` client gets it; `pnpm keycloak:check` fails if another client does.
- `directory:roster-national-id` is a realm client scope of its own (same shape) for a roster record's national ID (`/internal/v1/commissions/{slug}/roster/records/{recordId}/national-id`, with `X-Acting-Tenant`), which `InternalRosterRecord` leaves out. Only the `review` client gets it (spec 08: payroll's salary stoppage and the ICMS referral); `pnpm keycloak:check` fails if another client does. A local Keycloak imported before it existed must recreate the realm, or add the scope and the `review` client's default scope by hand.
- The confidential clients `declarations` (default scopes `directory:internal` and `messages`) and `notifications` (`directory:person-contacts`) have only a service account and development secrets `declarations-dev-secret` and `notifications-dev-secret`.
- The confidential client `review` (development secret `review-dev-secret`) has only a service account and the default scopes `declarations:internal` (submitted versions, read for a case and audited), `directory:internal` (policy, Commission reference and roster records), `directory:roster-national-id` (a roster record's national ID, for payroll and the ICMS referral), `documents:internal` (attachment downloads, letters), `messages`, `ai:internal` (the ai-gateway's internal routes, for the copilot: tasks and jobs, feedback on job outputs, and a tenant's AI status), `payroll` (spec 08: the integration-gateway's payroll instructions) and `registry` (spec 07b: the integration-gateway's KRA, NTSA, BRS and ArdhiSasa lookups, the employer-supplier check and stored result reads, with `X-Acting-Tenant`; `pnpm keycloak:check` fails if another client gets it). A local Keycloak imported before `registry` or `payroll` existed must recreate the realm, or add the scopes and the `review` client's default scopes by hand: the review service asks for both in one token, so without either every registry lookup is `gateway-unavailable`. `review:internal` is the scope of the review service's own `/internal/v1` routes (clarification letter payloads, with `X-Acting-Tenant`); the `documents` client has it by default, to pull those payloads when it renders a letter.
- The confidential client `reporting` (development secret `reporting-dev-secret`) has only a service account and the default scopes `declarations:internal`, `review:internal`, `directory:internal`, `messages`, `documents:internal` and `icms` (spec 09: registering a referral with ICMS through the integration-gateway).

## Declarations internal API (spec 06)

- `declarations:internal` is a realm client scope (in the token's `scope` claim, adds the `adili-api` audience) for the declarations service's `/internal/v1` routes, with `X-Acting-Tenant` as in "Service-to-service calls": a submitted version's acknowledgement slip payload (for documents), and a submitted version's document and the version before it (for review, spec 07a).
- The confidential client `documents` (default scopes `declarations:internal` and `review:internal`) has only a service account and the development secret `documents-dev-secret`: the documents service pulls the payload with it when it issues a slip. A local Keycloak imported before it existed must recreate the realm, or add the scope and the client by hand (as they are in `adili-realm.json`). A local Keycloak imported before `directory:person-contacts` existed must recreate the realm (or add the scope and swap the `notifications` client's default scope by hand) before notifications can read contacts.

After pulling a change to the extension or the theme, rebuild the image (`docker compose -f infra/compose/docker-compose.yml build keycloak`) and recreate the realm.

Passkeys are enabled as an optional required action (`webauthn-register`). They are not on the browser flow yet: passkey sign-in is #403.
