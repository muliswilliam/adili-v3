# ADR-009: API-first platform for Commissions, reporting entities and other agencies

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-004](0004-identity-keycloak-self-registration.md), [ADR-005](0005-message-queue-rabbitmq.md), [ADR-006](0006-multi-tenancy-and-hierarchy.md)

## Context

EACC will build portals for responsible Commissions and reporting entities, but those organisations **may build their own systems** and feed the required data back to EACC (Admin Mechanism 39: EACC modular system, EACC multi-tenant platform, or an internally developed system following EACC guidelines).

Other agencies also need data: law enforcement (s.36(2), Reg 23), appointing and vetting bodies needing compliance status, payroll systems enforcing salary stoppage, EACC's ICMS for referrals, and the public for transparency.

Agenda Track 7 asks for standardised data structures, schema validation, secure system authentication, acknowledgement of receipt, error handling, duplicate detection, version control, transaction logging and data provenance. Judges score scalability and interoperability.

## Decision

1. **API-first:** every capability is a documented public API, and **our own portals use the same APIs** (no private back doors). If our UI can do it, a Commission's system can too.
2. **Contracts:**
   - **OpenAPI 3.1** per service, published through one developer portal.
   - **JSON Schema** for the declaration (First Schedule), Form M and the other prescribed forms, versioned (`declaration.v1`).
   - Events for subscribers documented in **AsyncAPI**.
3. **Exposed APIs** (versioned under `/v1`):
   - **Declarations:** submit (from federated systems), status, acknowledgement retrieval
   - **Roster:** bulk upload and sync of officers, appointments and exits
   - **Clarifications:** issue and respond (federated Commissions)
   - **Compliance reports:** submit Form M, validate, fetch acknowledgement
   - **Directory:** reporting entities, Commissions, delegations, category rules
   - **Reference data:** asset types, income types, counties, currencies
   - **Access requests:** Form K intake and status
4. **Machine authentication:**
   - OAuth2 **client credentials** per organisation (Keycloak clients) with fine-grained scopes (`declarations:submit`, `roster:write`, `reports:submit`), tenant-bound tokens.
   - mTLS optional for high-assurance clients.
5. **Reliability semantics:**
   - `Idempotency-Key` required on all POSTs; the server stores the result so a retry returns the original response.
   - Duplicate detection on business keys (e.g. person + cycle + declaration type).
   - **Signed acknowledgement receipts** (reference number, content hash, timestamp) for every accepted submission, matching the acknowledgement slip (First Schedule note 11).
   - Errors as RFC 9457 problem details with field-level validation errors.
   - Per-client rate limits.
6. **Outbound notifications:** **signed webhooks** (HMAC, timestamped, retries with backoff), e.g. `clarification.issued`, `declaration.acknowledged`, `report.accepted`. External systems never connect to RabbitMQ.
7. **Provenance and logging:** every API transaction records client ID, organisation, payload hash, schema version and outcome in the audit trail (ADR-008).
8. **Versioning:** URL major version (`/v1`), additive changes only within a version, deprecation headers, and at least 12 months' notice before retiring a version.
9. **APIs for other government agencies** (separate API products, separate scopes, never bulk access to declarations):

| API | Consumers | What it returns | Legal basis / safeguard |
|---|---|---|---|
| **Law enforcement access** | DCI, ODPP, KRA investigations, FRC, Assets Recovery Agency, EACC investigators | Request intake (case reference, reason, scope) → responsible Commission decides → granted package delivered as a time-limited, watermarked, audited download | s.36(2), Reg 23: written request, declarant notified, no Form K needed. One request per case; no search or query access |
| **Compliance status verification** | Appointing authorities, Parliament vetting committees, PSC/county boards (recruitment, promotion), IEBC (2027 candidates) | Filing status per cycle: filed / not filed / under clarification / non-compliant / referred. **No financial content** | Officer consent (officer-issued verification code) or a statutory mandate registered per agency. Open question for EACC: s.46 confidentiality scope |
| **Verifiable compliance certificate** | Anyone holding the certificate | Officer downloads a signed DIALs compliance certificate with a QR code (like KRA's tax compliance certificate); a public endpoint verifies signature, validity and revocation | Officer-initiated disclosure of their own status |
| **Payroll / HR instructions** (outbound) | IPPD/HRMIS, county and parastatal payroll systems | Salary stoppage and reinstatement instructions with reference to the administrative action, acknowledgement required | Admin Mechanisms (Aug 2026) sanction ladder; only after a recorded decision by an authorised officer |
| **Referral to ICMS** (outbound) | EACC ICMS | Referral case: suspect data, grounds (undeclared/unexplained assets, 2 missed cycles), evidence package | Reg 20(1)(c), 20(2); Users & Workflows US 22 |
| **Open data (aggregates)** | Public, media, researchers, Parliament, Auditor-General | Compliance rates by Commission, entity and cycle; declaration counts; clarification and sanction statistics. **No personal data**; small groups suppressed (e.g. fewer than 10 officers) | Transparency (Act s.3(2)(f)); aggregates only |

   All agency APIs use the same foundations as items 4-8: client credentials per agency, scopes per API product, idempotency, signed receipts, full audit with legal basis, rate limits.

10. **Developer experience:**
   - A sandbox tenant with synthetic data.
   - TypeScript and Python client SDKs generated from OpenAPI.
   - A conformance test suite a Commission can run against its own system to prove it meets EACC guidelines (Admin Mechanism 39(c)).

## Alternatives considered

| Option | Why not |
|---|---|
| Portal-only (no public API) | Contradicts Admin Mechanism 39; forces double data entry for Commissions with their own systems. |
| GraphQL public API | Harder to cache, rate-limit and version for many external government clients; REST + OpenAPI is the common denominator for government ICT teams. |
| File exchange (SFTP/CSV) as the main integration | No real-time validation or acknowledgements; kept only for roster bulk upload. |
| External access to the message queue | Exposes internal topology; webhooks are simpler and safer for external parties. |

## Consequences

**Positive**
- Supports all three options in Admin Mechanism 39 with one platform.
- Strong interoperability story: standard schemas, signed receipts, idempotency, conformance tests.
- Using our own APIs keeps them complete and tested.

**Negative / risks**
- Public APIs are a long-term commitment: versioning and deprecation discipline required.
- Larger attack surface. Mitigations: scoped client credentials, rate limits, schema validation at the edge, WAF rules in Traefik, audit of every call.
