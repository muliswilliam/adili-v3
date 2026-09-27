# ADR-012: One polyglot monorepo (TypeScript + Python)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-009](0009-api-first-interoperability.md), [architecture §16](../architecture/README.md#16-repository-and-engineering-standards)

## Context

The codebase has:
- TypeScript: 3-4 TanStack Start apps, ~11 NestJS services, ~10 shared packages
- Python: a Django project simulating ~9 government systems (IPRS, KRA, NTSA, BRS, ArdhiSasa, HR, payroll, ICMS, SMS)

The options were one monorepo for everything, a TypeScript monorepo plus a separate Python repo, or one repo per service. Constraints:
- ~6 build days
- one team
- contracts (OpenAPI/JSON Schema) shared between the integration-gateway adapters and the mocks that implement them
- judges will review code quality, so the code should be easy to find and consistent

## Decision

1. **One monorepo** containing all apps, services, shared packages, the Django mocks, infrastructure config and docs.
2. **Tooling per language, orchestrated together:**
   - TypeScript: **pnpm workspaces + Turborepo** (build/test/lint caching, affected-only runs).
   - Python: **uv** project in `mocks/` (lockfile, virtualenv), **ruff**, **mypy**, **pytest**. A thin `package.json` in `mocks/` exposes `lint`/`test`/`build` scripts, so `turbo run test` covers Python too.
3. **Contracts are the seam between languages:** the external-system contracts live in `packages/schemas/external/` (OpenAPI per system). The TypeScript adapters in `integration-gateway` and the Django mocks are both **contract-tested against the same specs** in CI, so they can't drift.
4. **Independent build and deploy:** every app, service and mock has its own Dockerfile. CI builds only what changed (Turborepo affected + path filters). Dokploy deploys each one from its own path in the same repo.
5. **Boundaries enforced, not just agreed:**
   - Services may import `packages/*`, never another service's code (dependency-cruiser / ESLint `no-restricted-paths` rules in CI).
   - Services talk only through APIs and events.
   - `CODEOWNERS` per folder maps to team roles for reviews.
6. **Kept out of the repo:** secrets (Dokploy environment variables / OpenBao) and production environment configuration. In production, EACC would hold these in a separate, restricted ops repository.

```text
adili-v3/
├── apps/        portal · console · verify · keycloak-theme
├── services/    directory · declarations · review · access · reporting · documents ·
│                verification-api · ai-gateway · integration-gateway · notifications · audit
├── packages/    ui · data-access · authz · outbox · audit-client · numbering · events ·
│                api-kit · telemetry · schemas (incl. external/ contracts)
├── mocks/       Django project (uv): iprs · kra · ntsa · brs · ardhisasa · hr · payroll · icms · sms
├── infra/       compose, Dokploy config, seed data, runbooks
├── docs/        architecture, ADRs, glossary
├── turbo.json · pnpm-workspace.yaml · .github/workflows/ · CODEOWNERS
```

## Alternatives considered

| Option | Why not |
|---|---|
| **TypeScript monorepo + separate Python repo** | Splits the contract from one of its two implementations, so mocks and adapters drift. Two CI setups, two READMEs, and cross-repo PRs for one change. Judges see a fragmented codebase. The Python part is small and already isolated by folder and tooling, so splitting buys nothing. |
| **One repo per service (polyrepo)** | 15+ repos for a 6-day build. Shared libraries would need publishing and versioning through a registry; cross-cutting changes (e.g. the event envelope) would touch many repos. Heavy overhead, no benefit at our team size. |
| **Nx instead of Turborepo** | Stronger polyglot support and built-in module-boundary rules, but a steeper learning curve. Turborepo + pnpm + uv, with dependency-cruiser for boundaries, is simpler and enough. |

## Consequences

**Positive**
- A contract change, its TypeScript adapter and its Python mock land in **one atomic PR**, checked by one CI run.
- One place to review code quality, one README, one `docker compose up` for local development.
- The mocks can later serve as the **sandbox tenant's simulated government systems** for external developers (ADR-009).

**Negative / risks**
- Mixed-language CI needs path filters so Python jobs don't run on TypeScript-only changes (and vice versa).
- Repo size and CI time grow. Mitigated by Turborepo remote caching and affected-only builds.
- Revisit if the mocks become an independent product owned by another team with its own release cycle, or if EACC requires separate access control for parts of the code.

## Amendment (2026-09-28): Java for Keycloak providers

Keycloak extensions can only be written in Java, so `apps/keycloak-extension` (the `adili-otp` authenticator, #79) is a **Maven** module targeting Java 17. It stays small and behind Keycloak's SPI:

- Maven builds and tests it in the Keycloak CI workflow (`mvn verify`) and in the Keycloak image build. It has no `test` script in its `package.json`, so `turbo run test` does not need a JDK on every machine; the TypeScript there is only its stack tests (S22, S23).
- Its seams with the TypeScript services are HTTP contracts (notifications `sendMessage`) and the page contract with the theme (`apps/keycloak-theme/src/login/adili-otp.ts`).
- No other Java is added. Anything that can live in a service stays in TypeScript.
