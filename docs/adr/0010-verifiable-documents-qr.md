# ADR-010: Verifiable documents with QR codes

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-002](0002-object-storage-seaweedfs-demo-ceph-rgw-production.md), [ADR-006](0006-multi-tenancy-and-hierarchy.md), [ADR-008](0008-audit-trail.md), [ADR-009](0009-api-first-interoperability.md)

## Context

Team requirement: **every document that leaves the system must be verifiable.** Each document carries a QR code. Scanning it opens a public page that shows whether the document is valid. Sensitive content is never exposed (only validity is shown); publicly shareable content can be shown.

Documents leaving the system include:
- acknowledgement slips (First Schedule note 11)
- declarant copies of declarations
- clarification requests (s.35)
- compliance decisions and administrative action notices (notice to comply, warning, salary stoppage)
- Form K decisions and granted access packages
- law enforcement disclosure packages (Reg 23)
- Form M reports, the EACC consolidated report, referrals
- compliance certificates (ADR-009)
- exports (CSV/XLSX)

Forged EACC letters and certificates are a real risk (e.g. fake clearance or compliance letters in recruitment and vetting). **A QR code alone proves only that a document with that ID exists. A forger can copy a genuine QR code onto an altered document.** The design must also let a verifier check that the document in hand matches what was issued.

## Decision

### 1. Issuance pipeline (documents service, issuance module)

1. Render the document from a versioned template (HTML/React templates using the shared design system) to PDF with **Gotenberg** (Apache 2.0, self-hosted).
2. Create a **verification record** with a random, unguessable ID (128-bit, base32, e.g. `ADL-7Q4K-M2XR-9HTC-...`). The same ID is printed as a human-readable code under the QR code.
3. Embed the **QR code** (URL `https://verify.<domain>/v/<id>`), the verification code, the issuer and the issue date in the footer of every page.
4. **Digitally sign the PDF** (PAdES), so PDF readers show the signature as valid and detect any edit. Signing keys are held in OpenBao. The demo uses a demo CA; production uses a certificate from a Kenyan licensed certification service provider.
5. Store the final PDF's **SHA-256** in the verification record, and **sign the record** (Ed25519 via OpenBao transit). Even a database edit would be detectable.
6. Store the PDF in object storage (ADR-002); audit the issuance (ADR-008).

Non-PDF exports (CSV/XLSX) are registered the same way and delivered with a signed PDF cover sheet or manifest carrying the QR code and file hash.

### 2. Disclosure levels (set per document type in template policy, never chosen ad hoc)

| Level | Examples | Public page shows |
|---|---|---|
| **Public** | Compliance certificate (officer-initiated), open-data reports, EACC public consolidated report, public notices | Validity + the document's public fields or full rendered content |
| **Restricted** | Acknowledgement slips, clarification letters, compliance decisions, administrative notices, Form M reports | Validity + minimal matching metadata: document type, issuing Commission, issue date, reference number. **No names, amounts or findings** |
| **Confidential** | Law enforcement disclosure packages, access-grant packages, referrals to ICMS | **Validity only** ("Valid document issued through Adili Online"). Even the issuer or document type can reveal an investigation |

### 3. Verification record and status

`verification_records`: `id`, `document_type`, `template_version`, `disclosure_level`, `issuer_tenant`, `issued_at`, `content_sha256`, `public_payload` (only for Public/Restricted, already filtered), `status`, `status_reason_category`, `superseded_by`, `expires_at`, `record_signature`.

| Status | Meaning on the page |
|---|---|
| Valid | Issued by Adili Online and currently in force |
| Superseded | A newer version exists (e.g. amended declaration acknowledgement); links to the new one if its level allows |
| Revoked | Withdrawn, with a public reason category (e.g. "issued in error") |
| Expired | Past its validity period (e.g. compliance certificate for a past cycle) |
| Not found | No such document: likely forged |

### 4. Checking that the document matches (anti-forgery)

- **Public documents:** the page shows the content, so the viewer compares it with what they hold.
- **Restricted documents:** the page shows the reference number, type, issuer and date, to compare against the printed header.
- **Any digital copy:** "Check your file" on the page **hashes the PDF in the browser** (the file is never uploaded) and compares it with `content_sha256`. It reports "identical to issued document" or "does not match".
- **PDF signature:** readers such as Adobe show the PAdES signature, and any edit invalidates it.

### 5. Public verification service (isolated)

- A separate, minimal **`verify` web app** (TanStack Start) plus a **read-only verification API**, deployed in the public zone.
- It reads only a **replicated projection** of `verification_records` containing public-safe fields. It has **no network or database access** to declarations, review or audit data.
- Hardened:
  - random IDs, so documents can't be enumerated
  - rate limiting and a self-hosted proof-of-work challenge after repeated lookups
  - `noindex`, no personal data in URLs, strict security headers
- Every verification is audited (time, coarse origin). Declarants and issuers can see how often their document was verified.
- Works on basic phones: the page is lightweight and accessible. A future option is SMS/USSD verification by code.

### 6. Watermarking of disclosed content

Granted access packages and law enforcement packages carry a **per-recipient visible watermark** (recipient, request reference, date) plus the verification ID. A leaked copy traces back to its recipient (supports s.36(4)).

## Alternatives considered

| Option | Why not |
|---|---|
| QR code with ID only, no hash or signature | A genuine QR code can be pasted onto a forged document; no way to detect alterations. |
| Full signed payload inside the QR (offline verification) | QR codes get too dense for printing; the payload could leak sensitive data; revocation would not be visible offline. Could be added later as a compact signed token alongside the URL. |
| Blockchain anchoring per document | Adds operational complexity; signed records + audit anchors (ADR-008) + PAdES give the same tamper evidence. |
| Verification page reading the main databases | Public-facing component with access to sensitive data; unacceptable attack surface. |
| Issuer chooses the disclosure level per document | Inconsistent and error-prone; level is fixed per document type in versioned policy. |

## Consequences

**Positive**
- Any paper or digital document from the system can be checked by anyone in seconds, which counters forged EACC or Commission letters and certificates.
- Sensitive content is never exposed publicly; confidential investigations aren't revealed.
- Strong UX and security demo moment: scan the acknowledgement slip on stage, then show a tampered copy failing.

**Negative / risks**
- PDF signing needs certificate management (demo CA now; licensed provider in production).
- The public verify service is internet-facing: it must be hardened, monitored and kept isolated.
- Document templates become versioned artefacts with their own review and testing (visual regression tests for PDFs).
