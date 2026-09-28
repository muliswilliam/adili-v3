# ADR-008: Tamper-evident audit trail

- **Status:** Accepted; amended 2026-09-28: reads are recorded through the outbox (Pipeline step 2, spec #27)
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-001](0001-postgresql-as-sole-structured-data-store.md), [ADR-002](0002-object-storage-seaweedfs-demo-ceph-rgw-production.md), [ADR-005](0005-message-queue-rabbitmq.md), [research/database-sizing.md](../research/database-sizing.md)

## Context

- Declarations are highly sensitive. Unauthorised disclosure is an offence (s.36(4), s.46).
- Declarants must be notified of access requests (Reg 22(2), 23(2)).
- Track 3 requires "segregation of duties and strong audit controls".
- The audit trail must support investigations, disciplinary processes and court proceedings, so it must be **complete, attributable and tamper-evident**.
- Estimated volume: ~450M events per biennial cycle (~225GB); ~1.5k events/s at nominal peak and ~7k/s in the stress case.

## Decision

### What is audited

- Every **write**: create, update, submit, decide, delete.
- Every **read of sensitive data**: declaration views, document downloads, exports, and searches that return declarant records.
- **Authentication:** login, logout, MFA, failed logins, password and passkey changes (Keycloak event listener).
- **Authorisation changes:** role grants, delegations, break-glass use.
- **Configuration and policy version changes.**
- **Access requests (Form K and law enforcement):** grants, disclosures and denials.
- **Workflow transitions, AI calls (ADR-007) and integration calls.**
- **Denied attempts** (authorisation failures).

### Event schema

| Field | Content |
|---|---|
| `id` | UUIDv7 (time-ordered) |
| `occurred_at` | Server timestamp (UTC) |
| `actor` | type (user / service / system), id, roles, tenant, on-behalf-of |
| `action` | e.g. `declaration.viewed`, `clarification.issued` |
| `resource` | type, id, tenant, subject person id |
| `outcome` | success / denied / error |
| `legal_basis` | e.g. `s35-clarification:CLR-123`, `reg23-request:LEA-45`, `form-k:AR-678` |
| `context` | IP, user agent, session, request id, `traceparent` |
| `changes` | Field-level diff. **Financial values stored as hashes or encrypted**, never in plain text |
| `classification` | Data classification of the resource |
| `prev_hash`, `hash` | Chain links |

### Pipeline

1. **Writes:** the service writes the audit event into its **outbox in the same transaction** as the business change (ADR-005). There's no change without its audit record.
2. **Reads:** a request interceptor writes the audit event (`audit.read.v1`) into the service's **outbox** before the response is sent, and the relay publishes it like any other event (ADR-005). A read the audit trail cannot record fails instead of going unrecorded. Routes opt in with `@AuditedRead` (`packages/api-kit`); the interceptor is `AuditedReadInterceptor` (`packages/events`). **Denials:** published by request interceptors directly to RabbitMQ.
3. The **audit service** consumes, checks for duplicates, and **inserts in batches** (COPY) into the audit database.
4. **Hash chain per tenant per day:** `hash = SHA-256(prev_hash || canonical(event))`. Chains per tenant/day allow parallel writes.
5. **Daily anchor:** a Merkle root per tenant/day, **signed** with a key held in OpenBao, written to the `audit-archive` bucket with object lock. It can also be shared with EACC or an external custodian.
6. A **verifier job** recomputes chains and anchors, and alerts on any mismatch.

### Storage and protection

- A dedicated audit database (its own cluster in production), range-partitioned by month.
- The audit service role has **INSERT only**. No UPDATE or DELETE grants, plus triggers that reject both.
- 24 months hot. Older partitions are exported to Parquet in object-locked storage (Compliance mode) and kept at least as long as the related declarations (s.37: 5+ years after the officer leaves). Investigators query archives with DuckDB.
- Access to the audit trail is restricted to auditor and investigator roles, and **reading the audit trail is itself audited**.

### Transparency feature

Declarants get **"Who accessed my declaration"**: a timeline of every access to their record, with role, institution and legal basis (individual staff names hidden where policy requires). This supports the notification duties (Reg 22(2), 23(2)) and public trust.

## Alternatives considered

| Option | Why not |
|---|---|
| Application logs only | Not structured, complete or tamper-evident; not usable as evidence. |
| Database triggers (pgaudit / audit tables) | Record SQL, not business intent or legal basis. Miss reads served from cache. Useful as a complement for DBA activity, not as the audit trail. |
| Blockchain / distributed ledger | Operational complexity with no benefit over hash chains + signed anchors in WORM storage. |
| Separate event store (Kafka, ClickHouse) as the primary store | Extra technology; Postgres handles the volume (ADR-001). ClickHouse remains an option for audit analytics later. |
| Auditing writes only | Misses unauthorised viewing, the core confidentiality risk under s.36/s.46. |

## Consequences

**Positive**
- Complete, attributable, tamper-evident record usable for discipline and prosecution.
- Transactional completeness for writes via the outbox.
- The "who accessed my declaration" page is a visible trust and UX differentiator.

**Negative / risks**
- The largest dataset (~1.1TB in 10 years). Handled with partitioning and archiving.
- Read auditing costs a database write per audited read (the outbox row), even for reads that otherwise touch only a replica or cache. Accepted for reliability: publishing reads straight to RabbitMQ would lose the event on a crash between serving the read and publishing it.
- Canonical serialisation for hashing must be stable across versions. It's versioned (`hash_v`) and covered by tests.
