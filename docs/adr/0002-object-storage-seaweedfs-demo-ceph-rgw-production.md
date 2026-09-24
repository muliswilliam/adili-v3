# ADR-002: Object storage - S3 API, SeaweedFS for the demo, Ceph RGW for production (MinIO rejected)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-001](0001-postgresql-as-sole-structured-data-store.md), [research/database-sizing.md](../research/database-sizing.md)

## Context

Declarants upload supporting documents (title deeds, logbooks, payslips, bank letters, clarification evidence). The system also generates acknowledgement slips, Form M reports and audit archives. Requirements:

| Requirement | Source |
|---|---|
| Self-hosted in Kenya (data residency, government data) | Team constraint |
| ~7.5TB per biennial cycle, ~40TB logical in 10 years, ~95% of all bytes stored | Sizing |
| Upload bursts ~300Mbps nominal, ~3Gbps at 10x on deadline day | Sizing |
| Keep for 5+ years after the officer leaves | Act s.37 |
| Tamper resistance for legal records and audit archives (write-once, object lock) | Act s.36(4), s.46; Track 3 "strong audit controls" |
| Versioning, lifecycle rules, encryption at rest, replication to a second site | Retention, DR |
| Open-source licence with active maintenance | Long-term government use |

The team proposed MinIO. Its status as of today:
- Oct 2025: free Docker images stopped
- Dec 2025: "maintenance mode"
- Feb 2026: "no longer maintained"
- Apr 2026: repository archived, source only, no patches

A security-sensitive government system cannot depend on unmaintained storage.

## Decision

1. **The application talks only to the S3 API** (AWS SDK v3 in NestJS, boto3 in Python). No vendor-specific APIs. The storage backend is an infrastructure choice.
2. **Hackathon / demo: SeaweedFS** (Apache 2.0). Light, Docker-native, runs on a single Dokploy node, S3 gateway with versioning and basic object lock.
3. **Production: Ceph RGW** (LGPL). Proven at national scale; full S3 object lock (Governance and Compliance modes), versioning, lifecycle, erasure coding, multi-site replication to the DR data centre.
4. **Upload path:** the browser uploads straight to storage using a short-lived presigned URL issued by the Documents service. The bytes never pass through app servers, which keeps the ~3Gbps burst off the API tier. Each file then goes through:
   - quarantine bucket
   - ClamAV scan and MIME/size checks
   - move to a clean bucket
   - event to the queue (OCR/AI extraction)
5. **Bucket layout:** `quarantine`, `documents` (versioned, object lock after submission), `generated` (slips, Form M PDFs), `audit-archive` (Compliance-mode object lock, Parquet).
6. **Integrity and privacy:**
   - SHA-256 of every object stored in Postgres (`document_refs`) and included in the audit hash chain
   - Server-side encryption with keys from OpenBao
   - Object keys are opaque IDs: no names or ID numbers in keys or metadata
7. **Portability guard:** an S3 contract test suite (put/get, multipart, presign, versioning, object lock, lifecycle) runs in CI against SeaweedFS and can be run against Ceph before go-live.

## Alternatives considered

| Option | Why not |
|---|---|
| **MinIO** (original proposal) | Community edition archived Apr 2026: no releases, patches or official images. AGPL. The commercial successor (AIStor) is proprietary. |
| **Garage** | Light and easy, but has no object lock or versioning (endpoints return 501). Fails the tamper-resistance requirement. |
| **RustFS** | Apache 2.0 MinIO-like rewrite; promising but young. Watch it; not for a legal record store yet. |
| **Ceph RGW from day one (demo too)** | Considered and rejected by the team on 2026-09-24. cephadm manages its own containers, needs root and raw disks, so it doesn't fit Dokploy. Needs a dedicated VM (~8+ vCPU, 16GB RAM, 3 disks), has no laptop option, and needs an owner with Linux storage experience; a Ceph failure on demo day is too big a risk. Production parity is covered by the S3 contract tests instead. |
| **Files in Postgres (bytea/large objects)** | ~40TB would bloat backups, WAL and replicas, and push the upload burst through the database. Violates ADR-001's sizing assumptions. |
| **Plain filesystem / NFS** | No S3 semantics, object lock, versioning or native multi-site replication. |

## Consequences

**Positive**
- No dependency on an unmaintained product. Both choices are actively maintained open source.
- Upload bursts scale on the storage tier, not the API tier.
- Real WORM (write-once) guarantees for legal records and audit archives in production.
- Backend swap is a config change, backed by contract tests.

**Negative / risks**
- **Two backends:** SeaweedFS's object lock is less complete than Ceph's. Mitigation: the contract tests, and the pitch labels the demo backend as dev-scale.
- **Ceph is operationally heavy:** it needs skilled operators, 6+ nodes and 10Gbps networking. It's a production concern for EACC's ICT team, documented in the implementation roadmap.
- Presigned uploads need a strict CORS policy, short expiry, and content-length and content-type conditions.

## Revisit when

- RustFS or another Apache 2.0 store matures with full object lock and multi-site replication.
- EACC already runs a sovereign object store (e.g. in the Konza National Data Centre) that meets these requirements. Adopt it through the S3 API.
