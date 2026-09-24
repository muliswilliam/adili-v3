# ADR-004: Identity - Keycloak with verified self-registration

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-001](0001-postgresql-as-sole-structured-data-store.md), [ADR-006](0006-multi-tenancy-and-hierarchy.md), [ADR-009](0009-api-first-interoperability.md)

## Context

User groups:
- ~1.5M declarants
- Commission staff: reviewers, verifiers, approvers, admins
- Employer (reporting entity) HR focal points
- EACC analysts and supervisors
- Public applicants for access (Form K) and law enforcement agencies
- Helpdesk, auditors, and machine clients (external Commission and entity systems)

EACC's user stories say declarants **register themselves** (DIALs User story 1). Most Commissions and employers have no API we can call to confirm employment, so a roster-first onboarding would block most declarants. Identity itself can still be verified: **IPRS is national**, not per Commission.

Security requirements (Track 3):
- Strong authentication, least privilege, separation of duties
- Helpdesk and admins must not see financial content
- The solemn declaration is a legal act (s.39: false information is an offence)

## Decision

1. **Keycloak 26** (Apache 2.0), self-hosted, on its own Postgres database (ADR-001). **One realm** with **Keycloak Organizations** per tenant. About 160 realms would hurt performance and administration.
2. **Verified self-registration** for declarants:
   1. Enter national ID, date of birth and names. **IPRS check** (mocked in the demo) confirms they match.
   2. Verify phone (SMS OTP) and email. Set a password or passkey. Enrol MFA.
   3. **Employment claim:** pick the employer from the reporting-entity directory, then enter personal file number, designation, job group and appointment date. The system **derives the responsible Commission** from category rules (s.32, Reg 5, active delegations). The user confirms.
   4. The claim starts as **unverified**. It becomes verified by:
      - an employer HR focal point or the Commission (single or bulk approval), or
      - automatically, when it matches a roster the Commission has uploaded (CSV) or an HR API, when one exists.
   5. **Filing is never blocked by verification.** The legal duty to file is personal. Declarations from unverified claims are flagged for the reviewer.
3. **Rosters are optional and additive:** Commissions may upload a CSV or connect HR systems. Where a roster exists, non-filers are detected even if they never registered (needed for complete Form M figures). Where none exists, the list of expected declarants comes from verified registrations plus appointment and exit events.
4. **Authentication strength:**
   - Staff: MFA mandatory.
   - Declarants: MFA at login, plus **step-up re-authentication at submission** (the solemn declaration).
   - Public applicants: IPRS + phone OTP.
   - Law enforcement: institution-issued accounts with MFA.
   - Brokering to eCitizen and institutional directories can be added later without app changes.
5. **Authorisation split:**
   - Keycloak issues identity, roles and tenant memberships.
   - **Services decide access** with a shared CASL policy library: role × tenant × org-tree scope × data classification.
   - Postgres row-level security is the last line (ADR-006).
6. **Separation of duties:**
   - A reviewer cannot approve their own ruling.
   - Admin and helpdesk roles have no financial-content permission.
   - Break-glass access is time-boxed, needs a stated reason, and alerts supervisors.
7. **Tokens and sessions:**
   - TanStack Start server functions act as a **backend-for-frontend (BFF)**: tokens stay server-side, and the browser only holds an httpOnly, SameSite session cookie.
   - Access tokens last 5 minutes; refresh tokens rotate.
   - Machine clients (ADR-009) use OAuth2 client credentials with per-client scopes.
8. **Audit:** Keycloak login, MFA and failed-login events feed the audit pipeline (ADR-008).
9. **User experience: Keycloak stays invisible.**
   - **Our apps own the complex flows.** Registration (IPRS check, employment claim, Commission derivation), profile, and "security settings" (devices, passkeys, sessions) are TanStack Start screens. They create and manage users through the Keycloak Admin/Account REST APIs, from the backend only.
   - **Keycloak only renders a small set of pages:** login, OTP, passkey, forgot/reset password, verify email, step-up re-authentication, errors. These are built with **Keycloakify** (MIT) in React, using the **same design system package** (`packages/ui`: Tailwind tokens + shadcn/ui components) as the portals, so they're visually identical.
   - Keycloakify pages have Storybook stories for designers, English and Swahili translations, and accessibility checks; the theme JAR is built in CI and mounted into Keycloak.
   - Keycloak email templates (verification, reset) use the same branding. Our own notifications go through the notifications service.
   - **Never** use the Resource Owner Password grant to "hide" Keycloak behind a custom login form. It bypasses MFA, passkeys, brute-force protection and step-up, and is deprecated in OAuth 2.1.

## Alternatives considered

| Option | Why not |
|---|---|
| Roster-gated onboarding (HR match required) | Most Commissions have no employment API; it would block declarants from meeting a legal duty. Kept as optional auto-verification. |
| Open registration with no identity check | Anyone could file in another officer's name (s.39 exposure). IPRS verification is cheap and national. |
| Realm per tenant | ~160 realms hurts Keycloak performance and makes admin and upgrades painful. |
| Build auth in NestJS | Reinvents MFA, passkeys, brokering and session management; a security risk. |
| Zitadel / Authentik / Ory | Viable, but Keycloak has the deepest government adoption, Organizations, and brokering maturity. |
| Tokens in the browser (SPA pattern) | Exposed to XSS; the BFF pattern keeps tokens server-side. |

## Consequences

**Positive**
- Declarants can register and file on day one, with no dependency on Commission APIs.
- Identity is verified nationally (IPRS). Employment is verified progressively, and automatically wherever rosters or HR APIs exist.
- Strong authentication and separation of duties.

**Negative / risks**
- **Unverified employment claims:** someone could claim the wrong employer or Commission. Mitigations: IPRS identity check, flag on declarations, a verification queue for HR focal points, and the category rules that derive the Commission.
- **Non-filers who never register** are invisible without a roster. Mitigation: make roster upload easy (CSV template) and show each Commission its roster coverage on its dashboard.
- Keycloak is another stateful component to run (in the HA/DR plan).
