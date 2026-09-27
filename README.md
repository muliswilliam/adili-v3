# Adili Online V3 - DIALs

A national platform for the **Declaration of Income, Assets and Liabilities (DIALs)** under Kenya's [Conflict of Interest Act, 2025](docs/reference/legal/conflict-of-interest-act-2025.pdf) and [Conflict of Interest Regulations, 2026](docs/reference/legal/conflict-of-interest-regulations-2026-ln53.pdf).

Built for Track 3 of the **Adili Online V3 Innovation Challenge** (EACC × UNODC × Microsoft Africa Development Center).

## What it does

- **Public officers** register with a verified identity, file initial, biennial and final declarations for themselves, their spouse(s) and dependent children, with AI-assisted document pre-fill, and get a verifiable acknowledgement.
- **Responsible Commissions** (~160) review and verify declarations, request clarifications, take administrative action and file Form M compliance reports.
- **EACC** receives and consolidates compliance reports nationally and refers non-compliance for investigation.
- **The public and law enforcement** request access to declarations through controlled, audited processes. Anyone can verify a document issued by the platform with its QR code.

Designed for **1.5M declarants**, self-hosted in Kenya, API-first for Commissions and agencies that run their own systems.

## Status

Service skeletons are running end to end: infrastructure, 11 NestJS services, 3 web apps, the Keycloak theme and the government-system mocks. Domain features are built on top next.

## Local development

**Prerequisites:** Node 24+ (`.nvmrc`), pnpm 11 (`corepack enable`), uv, Docker (or Podman) with Compose.

```sh
pnpm bootstrap      # copy .env.example -> .env everywhere, install dependencies
pnpm infra:up       # Postgres, Valkey, RabbitMQ, Temporal, Keycloak, SeaweedFS, OpenBao, ClamAV, Gotenberg, Mailpit, OTel
pnpm db:migrate     # apply every service's migrations
pnpm db:seed        # synthetic data for the government-system mocks
pnpm dev            # all services, apps and mocks in watch mode
pnpm health         # readiness of everything
```

`pnpm check` runs formatting, lint, type checks, tests and module-boundary rules. `pnpm infra:down` stops the infrastructure. `pnpm infra:down -- --volumes` (or `pnpm infra:reset`) also deletes its data. `pnpm infra:health` checks compose health. Docker Compose and Podman Compose are both accepted.

Government-system mocks run on the host via `pnpm dev` (or `pnpm --filter @adili/mocks dev`) against the `mocks` database created by `infra:up`.

| Component                        | URL / port                                                            | Credentials |
| -------------------------------- | --------------------------------------------------------------------- | ----------- |
| portal (declarants)              | http://localhost:3010                                                 | demo accounts below |
| console (Commissions, EACC)      | http://localhost:3020                                                 | demo accounts below |
| verify (public)                  | http://localhost:3030                                                 | none |
| services `directory` ... `audit` | http://localhost:4001 ... 4011 (`/docs` for OpenAPI, `/health/ready`) | service env |
| government-system mocks          | http://localhost:8000 (SMS inbox `/sms/inbox`, payroll `/payroll/status`, ICMS `/icms/status`, flag map: `mocks/demo/REGISTRY_FLAGS.md`) | none (dev) |
| Keycloak                         | http://localhost:8080                                                 | `admin` / `admin_dev` |
| Temporal gRPC / UI               | `localhost:7233` / http://localhost:8233                              | namespace `adili` |
| Postgres                         | `localhost:55432`                                                     | `postgres` / `postgres_dev` |
| Valkey                           | `localhost:56379`                                                     | none |
| RabbitMQ AMQP / UI               | `localhost:55672` / http://localhost:15672                            | `adili` / `adili_dev` |
| SeaweedFS S3 / master            | `localhost:8333` / `localhost:9333`                                   | see `infra/compose/seaweedfs/s3.json` |
| OpenBao                          | http://localhost:8200                                                 | token `adili-dev-root-token` |
| ClamAV                           | `localhost:3310`                                                      | none |
| Gotenberg                        | http://localhost:3300                                                 | none |
| Mailpit SMTP / UI                | `localhost:1025` / http://localhost:8025                              | none |
| OTel collector OTLP              | `localhost:4317` (gRPC), `localhost:4318` (HTTP)                      | none |

Per-service Postgres roles (password is `<role>_dev`): `adili_directory`, `adili_declarations`, `adili_review`, `adili_access`, `adili_reporting`, `adili_documents`, `adili_verification`, `adili_ai_gateway`, `adili_integration_gateway`, `adili_notifications`, `adili_audit`, plus `keycloak` / `keycloak_dev`, `mocks` / `mocks_dev`, `temporal` / `temporal_dev`, `adili_test` / `adili_test_dev`.

Service ports: directory 4001, declarations 4002, review 4003, access 4004, reporting 4005, documents 4006, verification-api 4007, ai-gateway 4008, integration-gateway 4009, notifications 4010, audit 4011.

**Demo accounts** (password `Adili-Demo-2026`): `declarant`, `applicant`, `reporting-officer`, `reviewer`, `supervisor`, `commission-admin`, `access-officer`, `eacc-analyst`, `eacc-supervisor`, `auditor`, `helpdesk`, `platform-admin`, `law-enforcement`. Staff and law-enforcement enrol TOTP on first sign-in. Declarant and applicant SMS OTP is added by the #79 authenticator. The realm file is `infra/compose/keycloak/adili-realm.json`.

Container images (from the repo root):
- services: `docker build -f infra/docker/service.Dockerfile --build-arg SERVICE=directory .`
- apps: `docker build -f infra/docker/app.Dockerfile --build-arg APP=portal .`
- Keycloak with the Adili theme: `docker build -f infra/docker/keycloak.Dockerfile .` (`pnpm infra:up` builds it on first run)

## Documentation

|                                                               |                                  |
| ------------------------------------------------------------- | -------------------------------- |
| [Docs index](docs/README.md)                                  | Where to start                   |
| [Architecture](docs/architecture/README.md)                   | System design, diagrams, flows   |
| [Decisions (ADRs)](docs/adr/)                                 | Why we chose what we chose       |
| [Legal traceability](docs/requirements/legal-traceability.md) | How the law maps to features     |
| [User story coverage](docs/requirements/user-stories.md)      | EACC user stories → design       |
| [Glossary](docs/glossary.md)                                  | Reference-number codes and terms |

## Stack

TanStack Start (React) · NestJS on Fastify · PostgreSQL · Valkey · RabbitMQ · Temporal · Keycloak · SeaweedFS / Ceph RGW · OpenBao · Django (integration mocks) · Docker / Dokploy
