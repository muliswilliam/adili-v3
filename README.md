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

Design phase. The architecture and decisions are documented; implementation starts next.

## Documentation

| | |
|---|---|
| [Docs index](docs/README.md) | Where to start |
| [Architecture](docs/architecture/README.md) | System design, diagrams, flows |
| [Decisions (ADRs)](docs/adr/) | Why we chose what we chose |
| [Legal traceability](docs/requirements/legal-traceability.md) | How the law maps to features |
| [User story coverage](docs/requirements/user-stories.md) | EACC user stories → design |
| [Glossary](docs/glossary.md) | Reference-number codes and terms |

## Stack

TanStack Start (React) · NestJS on Fastify · PostgreSQL · Valkey · RabbitMQ · Temporal · Keycloak · SeaweedFS / Ceph RGW · OpenBao · Django (integration mocks) · Docker / Dokploy
