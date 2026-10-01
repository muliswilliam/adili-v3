# ADR-001: PostgreSQL as the sole structured data store (Cassandra dropped)

- **Status:** Accepted; amended 2026-10-01: drafts live in Postgres, Valkey only caches them (Decision 6, spec #108)
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Supporting analysis:** [research/database-sizing.md](../research/database-sizing.md), [research/dials-scope-and-scale.md](../research/dials-scope-and-scale.md)

## Context

The DIALs platform must serve every public officer in Kenya (Constitution Art. 260), filing with ~160 responsible Commissions plus their delegates (COI Act s.31-33, Regulations r.5). The first proposal was PostgreSQL for relational data (identity, users, tenancy) and Apache Cassandra for declarations and submissions, on the expectation of very high data volume.

Sizing at the design target (1.5M declarants, 10x burst headroom):

| Dimension | Estimate |
|---|---|
| Structured data | ~500GB per biennial cycle, ~2.2TB after 10 years (about half is audit) |
| Core legal data (roster, declarations, reviews, access, Form M) | ~140GB per cycle |
| Peak ingest (December deadline) | ~2MB/s nominal, ~20MB/s at 10x |
| Submissions | 7.5/s nominal, 75/s at 10x (~70 rows each, one transaction) |
| Audit events | ~1.5k/s nominal, ~7k/s stress (batched) |
| Draft autosaves | 1.7k-4.2k/s, absorbed by Valkey; ~300-1.4k/s flushed to the database |
| DB reads after cache | ~2k-5k qps |
| Uploaded files (not in the database) | ~7.5TB per cycle, in S3-compatible object storage |

The workload is dominated by relational operations:
- **Form M** (Regs r.25(2)) needs "officers who did not file" per Commission and cycle: an anti-join of the roster against submissions.
- **Reviewer queues** filter by tenant, status, risk and statutory deadline.
- **Material-change detection** (Act s.31(3)-(4)) compares a declaration with the same person's previous one, possibly held by another Commission.
- **EACC consolidation** aggregates across all tenants.
- **Submission is a legal act.** Declaration, status, acknowledgement, audit record and outbox event must commit atomically and be immutable after that.
- **Tenant isolation** across ~160 Commissions must be enforceable, not just by convention.

## Decision

1. **PostgreSQL is the only structured data store.** Cassandra is dropped.
2. **One logical database per microservice** (tenancy, declarations, review, access, reporting, notifications, audit, intelligence, integration). Keycloak and Temporal get their own databases. Heavy domains (declarations, audit) run on their own clusters in production.
3. **Declarations:** each submitted version is an immutable JSONB snapshot (the legal record), plus normalised `declaration_items` for analytics and material-change comparison. List-partitioned by declaration cycle.
4. **Audit:** append-only, hash-chained, range-partitioned by month, written in batches by a queue consumer. 24 months kept live; older partitions exported to Parquet in object-locked (write-once) storage.
5. **Multi-tenancy:** `tenant_id` on every tenant-scoped row, enforced with PostgreSQL row-level security. The org hierarchy (Commission → delegated body → reporting entity → department) is stored as an `ltree` path.
6. **Supporting pieces:**
   - Valkey for sessions, rate limits, reference data and a read cache of draft sections. *Amended 2026-10-01 (spec #108):* drafts are written to Postgres on every save, not written behind from Valkey. A save is one transaction that bumps the draft version (the `If-Match` check), stores the envelope-encrypted section (ADR-006) and records the audit event (ADR-008). A write-behind store could not give any of the three, and a lost Valkey would lose a declarant's work. Valkey keeps decrypted sections for 10 minutes, keyed by (declaration, section, version), so a reread costs no decrypt; losing it costs only that. The cost: at the design peak, up to 1.7k-4.2k autosaves/s reach the declarations cluster rather than the ~300-1.4k/s flushes the sizing assumed. If they become its bottleneck, the client debounces harder first, then Citus shards by tenant (point 8).
   - PgBouncer in front of each cluster.
   - Read replicas for reviewer search, dashboards and Form M.
   - Transactional outbox for publishing events to the message queue.
7. **HA and recovery:** Patroni for automatic failover, pgBackRest for point-in-time recovery to off-site object storage, async replica in a second Kenyan data centre.
8. **Documented scale path, adopted only when measured load requires it:**
   - Citus: shard by tenant, stays PostgreSQL
   - ClickHouse: EACC national analytics
   - YugabyteDB: if synchronous multi-DC with zero data loss becomes a hard requirement

## Alternatives considered

| Option | Why not |
|---|---|
| **PostgreSQL + Cassandra** (original proposal) | Built for 10k-100k+ writes/s per node and 10s-100s of TB; our peak durable load is ~20MB/s and ~12k rows/s. No joins or ad-hoc aggregation (Form M, queues, national rollups would need a table per query plus a Spark-style pipeline). No multi-table transactions for the atomic submit. Eventually consistent by default. No row-level security. Splitting the roster (Postgres) from declarations (Cassandra) would force cross-database sagas for every compliance report. Adds a second database to run, back up, restore and secure. |
| **ScyllaDB** | Same data-model limits as Cassandra; licence moved to source-available. |
| **CockroachDB** | No longer open source; licence and sovereignty risk for a government system. |
| **YugabyteDB from day one** | Postgres-compatible and Apache 2.0, but adds per-write consensus latency, a 3+ node minimum and Keycloak/Temporal compatibility risk for scale we don't need. Kept as a documented option. |
| **MongoDB** (document store for declarations) | Licence is SSPL (not open source). Weak for the joins and aggregates that drive Form M. JSONB in PostgreSQL covers the flexible-document need. |

## Consequences

**Positive**
- One database technology to operate, secure, back up and restore. It's already required by Keycloak and Temporal.
- ACID submits, immutable legal snapshots and DB-enforced tenant isolation.
- Form M, reviewer queues and national aggregates are plain SQL and materialised views.
- Mature HA/DR tooling (Patroni, pgBackRest), with point-in-time recovery for a legal record.
- A sizing-backed story for the judges' architecture and scalability criteria.

**Negative / risks**
- Vertical limits of a single primary. Mitigated by database-per-service, partitioning, replicas, client-debounced autosaves, queue-batched audit, and the documented Citus path.
- JSONB snapshot + normalised items duplicates data. Accepted: the snapshot is the legal record; the items are derived and can be rebuilt.
- The audit table grows fastest (~1.1TB in 10 years). Mitigated by monthly partitions and archiving to object-locked storage.
- Row-level security needs discipline: every connection must set the tenant context. Enforce with a shared data-access library and tests that assert cross-tenant reads fail.

## Revisit when

- Sustained durable writes exceed ~20k rows/s on a cluster, or live data on one cluster exceeds ~5TB.
- EACC requires synchronous multi-DC writes with zero data loss.
- National analytics queries measurably slow down OLTP (transactional) traffic even with replicas (move analytics to ClickHouse).
