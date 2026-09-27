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

`pnpm check` runs formatting, lint, type checks, tests and module-boundary rules. `pnpm infra:down` stops the infrastructure; `pnpm infra:reset` also deletes its data.

| Component                        | URL                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| portal (declarants)              | http://localhost:3010                                                                    |
| console (Commissions, EACC)      | http://localhost:3020                                                                    |
| verify (public)                  | http://localhost:3030                                                                    |
| services `directory` ... `audit` | http://localhost:4001 ... 4011 (`/docs` for OpenAPI, `/health/ready`)                    |
| government-system mocks          | http://localhost:8000 (SMS inbox `/sms/inbox`, flag map: `mocks/demo/REGISTRY_FLAGS.md`) |
| Keycloak (admin / admin_dev)     | http://localhost:8080                                                                    |
| Temporal UI                      | http://localhost:8233                                                                    |
| RabbitMQ (adili / adili_dev)     | http://localhost:15672                                                                   |
| Mailpit                          | http://localhost:8025                                                                    |

Service ports: directory 4001, declarations 4002, review 4003, access 4004, reporting 4005, documents 4006, verification-api 4007, ai-gateway 4008, integration-gateway 4009, notifications 4010, audit 4011.

**Demo accounts** (password `Adili-Demo-2026`): `declarant`, `reporting-officer`, `reviewer`, `supervisor`, `commission-admin`, `access-officer`, `eacc-analyst`, `eacc-supervisor`, `auditor`, `helpdesk`, `platform-admin`.

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
