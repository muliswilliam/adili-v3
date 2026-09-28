# ADR-015: Java for Keycloak providers

- **Status:** Accepted
- **Date:** 2026-09-28
- **Deciders:** Adili V3 DIALs team
- **Supersedes:** [ADR-012](0012-single-polyglot-monorepo.md) in part: the repo was TypeScript and Python only. The rest of ADR-012 still stands.
- **Related:** [ADR-004](0004-identity-keycloak-self-registration.md), [ADR-013](0013-service-communication.md), [ADR-014](0014-roster-gated-declarant-onboarding.md)

## Context

Spec 03 needs a sign-in step Keycloak does not have: after the password, declarants and applicants get a one-time code by SMS, or by email as fallback, sent through the notifications service (#79). Keycloak runs authentication steps only as Java providers loaded from JARs (the Authenticator SPI). Keycloak's scripted authenticators are deprecated and cannot call a service with a client-credentials token.

ADR-012 limited the monorepo to TypeScript (the platform) and Python (the mocks).

## Decision

1. **Java, for Keycloak providers only.** `apps/keycloak-extension` is a Maven module targeting Java 21 (the runtime of Keycloak 26). It holds Keycloak SPI implementations and nothing a service could do instead.
2. **Tooling:** Maven builds and tests it. CI runs `mvn verify` in the Keycloak workflow before the Keycloak image is built, and the image build packages the JAR next to the theme. Its `package.json` has no `test` or `build` script, so `turbo run test` does not need a JDK on every machine. The TypeScript there is only its stack tests (S22, S23).
3. **Seams stay contracts:** the extension talks to the platform over the notifications HTTP contract (`sendMessage`) and to the theme through the page contract in `apps/keycloak-theme/src/login/adili-otp.ts`.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| **A separate repo for the extension** | Splits the authenticator from the realm flow, the theme page it renders and the stack tests that drive them, which change together. |
| **Keycloak's built-in OTP (TOTP) for declarants** | Needs an authenticator app; the spec asks for codes to the phone and email the roster holds. |
| **Code step outside Keycloak (in the portal)** | Keycloak would issue tokens before the second factor, and step-up (spec 06) could not rely on Keycloak's level of authentication. |

## Consequences

**Positive**
- The second factor is enforced by Keycloak itself, with its level-of-authentication and brute-force protection.

**Negative / risks**
- A third toolchain (JDK, Maven) in CI and in the Keycloak image build.
- Keycloak's Authenticator SPI is internal and may change between versions. The pinned Keycloak version and the stack tests catch breaks on upgrade.
