# ADR-011: Human-readable reference numbers

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-006](0006-multi-tenancy-and-hierarchy.md), [ADR-008](0008-audit-trail.md), [ADR-009](0009-api-first-interoperability.md), [ADR-010](0010-verifiable-documents-qr.md)

## Context

EACC staff, Commissions and officers refer to matters by number (e.g. case numbers in ICMS). People quote them on the phone, in letters, in minutes, in court filings and in helpdesk tickets. Every significant record needs a **stable, human-readable reference number**, shown in the UI, documents, emails/SMS, API responses and exports.

Internal IDs (UUIDv7) aren't human-friendly. The verification ID (ADR-010) is deliberately random, for privacy, and isn't meant for everyday reference.

## Decision

### 1. Three identifiers, three purposes

| Identifier | Example | Purpose | Visible to |
|---|---|---|---|
| Internal ID | `0192f3a4-...` (UUIDv7) | Primary key, joins, events | Systems only |
| **Reference number** | `DCB-TSC-2027-0012345-A` | Everyday human reference | Authorised users, on documents |
| Verification ID | `ADL-7Q4K-M2XR-9HTC` | Public QR verification (ADR-010); random, can't be enumerated | Anyone holding the document |

Reference numbers are sequential and so guessable. They are **never used as public URLs or access tokens**, and knowing a number grants no access.

### 2. Format

`<TYPE>-<ISSUER>-<PERIOD>-<SEQUENCE>-<CHECK>`

- **TYPE:** 3-letter code for the record type (table below)
- **ISSUER:** tenant/body short code from the directory: `PSC`, `TSC`, `NPSC`, `JSC`, `EACC`, `CPSB047` (county boards use the standard 001-047 county codes), etc.
- **PERIOD:** declaration year for declarations; financial year end for Form M (e.g. `2027` = FY 2026/27); calendar year of creation for everything else
- **SEQUENCE:** 7 digits, zero-padded, per (type, issuer, period)
- **CHECK:** one check character (ISO 7064 MOD 37-36) over the whole string. It catches typos and swapped characters instantly, e.g. when a number is read out on the phone.
- Hyphen separators only (URL-safe, no slashes). **No personal data** in any number.

| Code | Record | Example |
|---|---|---|
| `DCI` / `DCB` / `DCF` | Initial / biennial / final declaration (the number is also the acknowledgement receipt number) | `DCB-TSC-2027-0012345-A` |
| `CLR` | Clarification request (s.35) | `CLR-PSC-2028-0000451-1` |
| `CMP` | Compliance determination | `CMP-PSC-2028-0003120-S` |
| `ADM` | Administrative action (notice, warning, salary stoppage, disciplinary) | `ADM-CPSB047-2028-0000087-D` |
| `ARQ` | Access request, Form K (s.36, Reg 22) | `ARQ-JSC-2028-0000012-A` |
| `LEA` | Law enforcement access request (Reg 23) | `LEA-PSC-2028-0000004-9` |
| `RPT` | Form M compliance report | `RPT-TSC-2028-0000001-B` |
| `NCR` | EACC national consolidated report | `NCR-EACC-2028-0000001-Z` |
| `RFL` | Referral to EACC / ICMS (Reg 20) | `RFL-PSC-2028-0000031-H` |
| `CRT` | Compliance certificate (ADR-009) | `CRT-TSC-2027-0098765-I` |
| `DLG` | Delegation record (s.33, s.7(c)) | `DLG-PSC-2026-0000003-K` |
| `OFR` | **Officer reference**: permanent, person-level, not tied to a tenant (follows the person across transfers; used by helpdesk instead of the national ID) | `OFR-0482913-L` (no issuer or period) |

The code list and formats live in a versioned **numbering scheme registry** (configuration data), so EACC can add record types or adjust formats without code changes. **Issued numbers are never changed, renumbered or reused.**

### 3. Allocation

- Numbers are allocated by the **service that owns the record**, through a shared numbering library, inside the **same database transaction** that creates the record. There's no central numbering service (no extra network hop, no single point of failure).
- **Gapless per sequence:** a counter row per (type, issuer, period), updated with `UPDATE ... RETURNING` in the business transaction. Postgres `SEQUENCE`s would leave gaps on rollback, and auditors question gaps in legal registers.
- Numbers are assigned **at the legal act**, not at draft creation. A declaration gets its `DC*` number when submitted; drafts have internal IDs only.
- Contention: peak ~75 submissions/s (10x), spread over ~160 issuers. Even the busiest counter (TSC) stays well within Postgres row-update limits for short transactions.

### 4. Relationships and external numbers

- Child records store and display their parent reference: a clarification shows "re: `DCB-TSC-2027-0012345-A`".
- **External references** are stored alongside ours and searchable, with the source system recorded:
  - numbers from federated Commissions' own systems (ADR-009)
  - **ICMS case numbers** returned when a referral is accepted
  - Gazette notice numbers for delegations
  - court or law enforcement case references on LEA requests

### 5. Where numbers appear

- **Documents:** header ("Ref:") and footer of every page, next to the QR verification code (ADR-010)
- **UI:** page titles, breadcrumbs, lists, copy-to-clipboard button
- **Notifications:** emails and SMS ("Declaration DCB-TSC-2027-0012345-A received")
- **APIs, webhooks, exports:** a `reference` field on every resource (ADR-009); Form M non-filer lists; CSV/XLSX exports
- **Audit events:** `resource.reference` (ADR-008), so investigators can search the trail by number

### 6. Built-in glossary (making numbers self-explanatory)

The numbering scheme registry stores, for every type code and issuer code, a **name, a plain-language description (English and Swahili) and the legal basis**. From that single source:

- **Reference chip:** anywhere a reference number is shown, hovering or tapping it breaks it down, e.g. "DCB = Biennial declaration · TSC = Teachers Service Commission · 2027 = declaration year · 0012345 = sequence · K = check character", with a link to the glossary.
- **Glossary page** in the help centre (public, no login): all type codes, issuer codes and key DIALs terms (responsible Commission, statement date, material change, clarification, etc.), searchable, in English and Swahili.
- **Documents:** a one-line "How to read this reference" note in the footer, pointing to the glossary URL.
- **API:** `GET /v1/reference-data/numbering-schemes` and `/v1/reference-data/issuers` (ADR-009), so external systems can show the same explanations.
- Seed content: [docs/glossary.md](../glossary.md).

### 7. Universal search

A single search box accepts any reference number:
- the type code routes to the right record
- the check character gives instant "did you mistype?" feedback
- **authorisation still applies** (ADR-006): users only see records within their tenant and scope

## Alternatives considered

| Option | Why not |
|---|---|
| Show UUIDs to users | Unreadable; can't be quoted on the phone or in letters. |
| Postgres `SEQUENCE` per type | Gaps on rollback; hard to scope per issuer and period. |
| Central numbering microservice | Extra network hop and single point of failure for every legal act; a shared library + counter tables in each owning service is simpler and transactional. |
| Numbers derived from national ID or names | Personal data in every letter, log and URL. |
| Reference number in the public QR URL | Sequential numbers can be enumerated; the verification ID (ADR-010) stays separate. |
| Slash format (`EACC/DIAL/2027/123`) | Traditional in letters but not URL- or file-name-safe; hyphens display just as clearly. |

## Consequences

**Positive**
- Every matter can be quoted, searched and cross-referenced by staff, officers, Commissions and ICMS.
- Gapless, per-issuer registers match how auditors and courts expect official numbering to work.
- Typos caught instantly by the check character.

**Negative / risks**
- Gapless counters serialise allocation per (type, issuer, period). Acceptable at our volumes; revisit if one issuer sustains hundreds of allocations per second.
- The numbering registry and issuer codes must be governed (new Commissions, delegations, county codes).
- Cancelled or withdrawn records keep their numbers, with a clear status, so the register stays gapless.
