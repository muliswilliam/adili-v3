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

## Law-enforcement accounts (spec 10)

- A platform admin provisions an officer for an agency (`POST /v1/law-enforcement/agencies/{code}/officers` on the directory), through the same `directory` client: username = official email, realm role `law-enforcement`, the staff required actions, and the admin-only attributes `tenant` (always `lea`), `agency` (the agency code, e.g. `DCI`), `person_id` (the officer's directory person) and `phone`. The activation email is the staff one (72 hours, `client_id=console`). Revoking disables the account.
- Officers are neither declarants nor applicants, so sign-in goes through `adili staff totp`.
- No client maps `agency` to a claim: the access service reads the officer's agency, account and its state from the directory (`/internal/v1/law-enforcement/officers/{personId}`, by the token's `person_id`), so a revoked account or a changed agency counts at once rather than at the next sign-in. The demo `law-enforcement` user is seeded with the demo applicant (see "Applicant accounts").

## Applicant accounts (spec 10)

- Applicant onboarding's complete step creates applicants through the same `directory` client: username = email (not yet verified; using the set-password link verifies it), realm role `applicant`, required action `UPDATE_PASSWORD`, no `tenant` (an applicant may ask any Commission), and the admin-only attributes `person_id`, `phone` (where `adili applicant otp` sends sign-in codes) and `identityStatus`.
- `identityStatus` is `verified` (IPRS matched the national ID at start, or an access officer verified a passport applicant's particulars through the directory) or `pending-verification` (a passport applicant until then). It is declared admin-only in the user profile and not mapped to tokens: the access service reads it from the directory (`/internal/v1/applicants/{personId}`), so a verification counts at once rather than at the next sign-in.
- The set-password email is the same execute-actions email as declarants' (24 hours, `client_id=portal`, `redirect_uri=<portal>/auth/login`).
- The demo `applicant` (Njoki Wambua) is imported with a fixed Keycloak id, `person_id` and `identityStatus` `verified`, and the demo `law-enforcement` officer (Suleiman Ali, `DCI`) with a fixed id and `person_id`. `pnpm db:seed` creates the directory persons they name (and the officer's account, `activated`) from `services/directory/src/persons/demo-seed.ts`, which `test/persons/demo-seed.integration.test.ts` keeps in step with this file. A local Keycloak imported before must recreate the realm (or set the ids and attributes by hand) for them to file a Form K or a law enforcement request.
- A local Keycloak imported before `identityStatus` was declared must recreate the realm (or add the attribute to the user profile by hand) before applicant accounts can be created.

## HR-system API clients (spec 27)

- The directory creates one confidential client per Commission's credential (`roster-<slug>-<hex>`) with only a service account, the default client scopes `basic` and `roster:write`, a hard-coded `tenant` claim and the `adili-api` audience. Rotating regenerates the secret; revoking disables the client. For that the `directory` service account also has realm-management `manage-clients`, `view-clients` and `query-clients`.
- `roster:write` is a realm client scope, included in the token's `scope` claim and in no client's defaults except those API clients.
- Listing `clientScopes` in the file replaces Keycloak's built-in scopes, so the file lists them all (as Keycloak 26.7 creates them) plus Adili's own (`roster:write`, `documents:internal`, `messages`, `iprs`, `directory:internal`, `directory:person-contacts`, `directory:roster-national-id`, `directory:applicants`, `directory:law-enforcement`, `declarations:internal`, `declarations:disclosures`, `review:internal`), and the realm defaults. `pnpm keycloak:check` fails when a client names a scope the file does not list. Keycloak's own clients (`account`, `account-console`, `admin-cli`, `broker`, `realm-management`, `security-admin-console`) are created before the scopes on import and so get no default scopes; Adili uses none of them (the account console is off, `accountThemeImplementation: 'none'`, and admins use the master realm).

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
- `directory:person-contacts` is a realm client scope of its own (same shape) for a person's verified contacts (`/internal/v1/persons/{personId}/contacts`, with `X-Acting-Tenant`: a declarant must be onboarded at that tenant; law enforcement officers and applicants, who belong to no Commission, are answered for any tenant, ADR-013 §8.8). Contacts are personal data, so only the `notifications` client gets it; `pnpm keycloak:check` fails if another client does.
- `directory:roster-national-id` is a realm client scope of its own (same shape) for a roster record's national ID (`/internal/v1/commissions/{slug}/roster/records/{recordId}/national-id`, with `X-Acting-Tenant`), which `InternalRosterRecord` leaves out. Only the `review` client gets it (spec 08: payroll's salary stoppage and the ICMS referral); `pnpm keycloak:check` fails if another client does. A local Keycloak imported before it existed must recreate the realm, or add the scope and the `review` client's default scope by hand.
- `directory:applicants` is a realm client scope of its own (same shape) for applicants' particulars and the record of an access officer's verification of a passport applicant (`/internal/v1/applicants/{personId}` and `.../identity-verification`, with `X-Acting-Tenant`, spec 10). Personal data, so only the `access` client gets it (by default); `pnpm keycloak:check` fails if another client does.
- `directory:law-enforcement` is a realm client scope of its own (same shape) for a law enforcement officer's agency, Keycloak account and its state (`/internal/v1/law-enforcement/officers/{personId}`, with any `X-Acting-Tenant`, spec 10), against which the access service records a request's provenance. Only the `access` client gets it; `pnpm keycloak:check` fails if another client does.
- The confidential clients `declarations` (default scopes `directory:internal` and `messages`) and `notifications` (`directory:person-contacts`) have only a service account and development secrets `declarations-dev-secret` and `notifications-dev-secret`.
- The confidential client `review` (development secret `review-dev-secret`) has only a service account and the default scopes `declarations:internal` (submitted versions, read for a case and audited), `directory:internal` (policy, Commission reference and roster records), `directory:roster-national-id` (a roster record's national ID, for payroll and the ICMS referral), `documents:internal` (attachment downloads, letters) and `messages`. `review:internal` is the scope of the review service's own `/internal/v1` routes (clarification letter payloads, with `X-Acting-Tenant`); the `documents` client has it by default, to pull those payloads when it renders a letter.
- The confidential client `reporting` (development secret `reporting-dev-secret`, spec 09) has only a service account and the default scopes `directory:internal` (the Commission and its staff), `declarations:internal` (officer details for Form M's rows), `review:internal` (clarification details, a referral's ICMS payload), `documents:internal` (Form M, receipt and NCR PDFs) and `messages`. The integration-gateway's ICMS route and its scope are not built yet, so the client has no scope for it.
- The confidential client `access` (development secret `access-dev-secret`, spec 10) has only a service account and the default scopes `directory:internal` (Commissions, roster records for resolving the officer a request names, staff), `directory:applicants` (applicants' particulars for Form K, recording a passport applicant's verification), `directory:law-enforcement` (the officer behind a law enforcement request), `declarations:disclosures` (scoped disclosures and full documents for certified copies, audited there), `declarations:internal` (a declarant's submitted versions, for a written self-access application), `documents:internal` (packages, certified copies, representation attachments) and `messages`. Its acting-tenant routes are ADR-013 §8.8. A local Keycloak imported before it existed must recreate the realm (`pnpm infra:reset && pnpm infra:up`), or add the client by hand (as it is in `adili-realm.json`).

## Declarations internal API (spec 06)

- `declarations:internal` is a realm client scope (in the token's `scope` claim, adds the `adili-api` audience) for the declarations service's `/internal/v1` routes, with `X-Acting-Tenant` as in "Service-to-service calls": a submitted version's acknowledgement slip payload (for documents), and a submitted version's document and the version before it (for review, spec 07a).
- `declarations:disclosures` is a realm client scope of its own (same shape) for the disclosure routes (spec 10): a grant's scoped disclosure (`POST /internal/v1/declarations/disclosures`) and a version in full for a certified copy (`GET /internal/v1/declarations/{declarationId}/versions/{version}/full-document`), both decrypted and audited as disclosures. Only the `access` client gets it; `pnpm keycloak:check` fails if another client does.
- The confidential client `documents` (default scopes `declarations:internal` and `review:internal`) has only a service account and the development secret `documents-dev-secret`: the documents service pulls the payload with it when it issues a slip. A local Keycloak imported before it existed must recreate the realm, or add the scope and the client by hand (as they are in `adili-realm.json`). A local Keycloak imported before `directory:person-contacts` existed must recreate the realm (or add the scope and swap the `notifications` client's default scope by hand) before notifications can read contacts.

After pulling a change to the extension or the theme, rebuild the image (`docker compose -f infra/compose/docker-compose.yml build keycloak`) and recreate the realm.

Passkeys are enabled as an optional required action (`webauthn-register`). They are not on the browser flow yet: passkey sign-in is #403.
