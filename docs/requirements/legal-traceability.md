# Legal traceability matrix

Every DIALs capability traces to the law. **Act** = [Conflict of Interest Act, 2025](../reference/legal/conflict-of-interest-act-2025.pdf); **Regs** = [Conflict of Interest Regulations, 2026](../reference/legal/conflict-of-interest-regulations-2026-ln53.pdf); **AM** = EACC Administrative Mechanisms for Part IV (Gazette, Aug 2026; official text pending, see [legal reference](../reference/legal/README.md)).

## Who and to whom

| Provision | Requirement | Capability | Where |
|---|---|---|---|
| Act s.2, Constitution Art. 260 | "Public officer" and "reporting entity" definitions | Configurable declarant categories; national directory of reporting entities | directory · ADR-006 |
| Act s.4 | Applies to all reporting entities and public officers | Multi-tenant platform for all ~160 Commissions; federated option | ADR-006, ADR-009 |
| Act s.31(1) | Declare for self, spouse(s), dependent children under 18 | Household capture; one financial statement per person | declarations |
| Act s.31(2), First Schedule | Prescribed form | Declaration JSON Schema mirrors the First Schedule | packages/schemas |
| Act s.32(1)-(16), Regs r.5 | Responsible Commission per category | Category rules derive the tenant; body keeps responsibility after delegating (s.32(16)) | directory · ADR-006 |
| Act s.33, s.7(c), Regs r.4 | Delegations (PSC below job group M; EACC delegations) | Delegation records with Gazette reference, scope, validity; drive access policy | directory · ADR-006 |
| First Schedule note 4 | Applies to officers on leave, discipline, secondment, overseas; only AG can exempt | Obligations continue regardless of status; exemption registry | declarations |

## Declaring

| Provision | Requirement | Capability | Where |
|---|---|---|---|
| Act s.34(1), note 6 | Initial within 30 days of appointment; covers year before | Obligation created on appointment; derived type; deadline timer | declarations · ADR-003 |
| Act s.34(2), note 7 | Biennial: statement date 1 Nov, filed in December | Cycle calendar; staggered reminders | declarations, notifications · ADR-003 |
| Act s.34(3), note 8 | Final within 30 days of leaving | Obligation created on exit; limited account access continues after exit | declarations, directory |
| Act s.31(3)-(4), Regs r.21 | Material changes over 2 years: ±25% value, acquisition/disposal, marital status, directorships, memberships | Automatic comparison with previous declaration (across tenants); explanations recorded | declarations · ADR-006 |
| Note 13 | Assets outside Kenya; joint assets | Location and joint-share fields; currency handling | declarations |
| Notes 1, 12; Regs r.33 | Electronic filing valid without signature | Online filing; solemn declaration + step-up re-authentication | portal · ADR-004 |
| Note 11 | Acknowledgement slip for each form | Signed, QR-verifiable acknowledgement with reference number | documents · ADR-010, ADR-011 |
| Act s.39 | False information is an offence | Solemn declaration; identity verification; immutable submitted versions | declarations · ADR-004 |

## Review, clarification and enforcement

| Provision | Requirement | Capability | Where |
|---|---|---|---|
| Act s.35(1), Regs r.20(1)(a) | Analyse for COI issues, discrepancies, completeness and correctness | Deterministic rules + AI summary; risk flags as indicators | review · ADR-007 |
| Regs r.20(1)(b), Act s.35(5), AM 37(e) | Compare with other sources; verify | Integration checks: KRA, NTSA, BRS, ArdhiSasa, IPRS, HR | integration-gateway |
| Act s.35(2)-(4) | Clarification within 6 months; reply within 30 days | `ClarificationWorkflow` timers, reminders, escalation | review · ADR-003 |
| Act s.38 | Failure to submit is an offence | Obligation tracking; non-filer detection; escalation | declarations, review |
| AM (sanctions) | Notice to comply, warning, salary stoppage, disciplinary | Administrative action ladder; payroll instruction API | review · ADR-009 |
| Regs r.20(1)(c), Act s.6(i) | Refer undeclared or unexplained assets to EACC; forfeiture | Referral cases (`RFL-…`) with evidence package → ICMS | reporting · ADR-009 |
| Regs r.20(2) | Refer after 2 consecutive missed cycles or unanswered clarifications | Automatic referral in `FilingObligationWorkflow` | declarations · ADR-003 |
| Regs r.20(1)(d), AM 37 | ICT system to process and manage declarations | The platform | - |

## Reporting and oversight

| Provision | Requirement | Capability | Where |
|---|---|---|---|
| Regs r.25(2)(a) | Form M for biennial declarations by 31 July of the following year | Auto-compiled Form M; `ComplianceReportWorkflow` | reporting · ADR-003 |
| Regs r.25(2)(b) | Form M for initial and final declarations by 31 July after financial year end | Same, per financial year | reporting |
| Regs r.25(3), AM 40(3) | Reports may be filed electronically | Electronic submission, signed receipts, API for federated Commissions | reporting · ADR-009 |
| Act s.5-6 | EACC administers and oversees | EACC intake, national consolidation, dashboards; not a super-tenant | reporting · ADR-006 |

## Access, confidentiality and retention

| Provision | Requirement | Capability | Where |
|---|---|---|---|
| Act s.36(1), Regs r.22, Form K | Access on application showing legitimate interest | Form K online (`ARQ-…`) | access |
| Act s.36(3), Regs r.22(2) | Notify declarant; representations before an affirmative decision | `AccessRequestWorkflow`; representation window | access · ADR-003 |
| Regs r.22(3), r.24 | Grant (scope, manner) or deny with reasons; grounds for denial | Decision recording with Reg 24 grounds | access |
| Act s.36(2), Regs r.23 | Law enforcement access after due process; written request; declarant notified | LEA route and API (`LEA-…`); no bulk access. Product decision 2026-10-05: the declarant is not told of law enforcement requests (deviation from r.23(2), #614) | access · ADR-009 |
| Act s.36(4), s.46 | Unauthorised publication and disclosure are offences; confidentiality | RLS + CASL, per-tenant encryption, audited reads, watermarked packages | ADR-006, ADR-008, ADR-010 |
| Act s.37 | Keep for at least 5 years after officer leaves | Retention policy; object lock; audit archives kept as long | ADR-002, ADR-008 |
| AM 37(h)-(i) | Confidentiality, integrity, secure storage and retrieval | Encryption, hash-chained audit, signed documents, backups | ADR-008, ADR-010, architecture §13 |

## Administrative Mechanism 37: automated system capabilities

| AM 37 | Capability required | Where |
|---|---|---|
| (a) | Reminders and notifications | notifications, `FilingObligationWorkflow` |
| (b) | Fill and submit declarations online | portal, declarations |
| (c) | Acknowledgement to officer / Commission | documents (signed, QR) |
| (d)(i) | Completeness | review rules, portal validation |
| (d)(ii) | Discrepancy and inconsistency detection | review rules, integration checks, material-change comparison |
| (d)(iii) | Flag possible conflicts of interest | risk flags (e.g. BRS directorships vs employer's suppliers) |
| (e) | Interconnect with other information systems | integration-gateway · ADR-009 |
| (f) | Receive and process access requests | access |
| (g) | Generate and submit required reports | reporting (Form M, national report) |
| (h) | Confidentiality and integrity | ADR-006, ADR-008 |
| (i) | Secure storage, retention, retrieval | ADR-001, ADR-002 |

## Administrative Mechanism 39: implementation options for Commissions

| Option | Support |
|---|---|
| (a) Modular EACC system integrating with existing systems | Public API + webhooks (ADR-009) |
| (b) Centralised multi-tenant platform hosted by EACC | Hosted tenants (ADR-006) |
| (c) Internally developed system following EACC guidelines | Federated tenants, JSON Schemas, conformance test suite (ADR-009) |

## Related law (not implemented in code, shapes design)

| Law | Effect on design |
|---|---|
| Data Protection Act 2019 (ss.48-50) and General Regulations 2021 | Data residency, cross-border restrictions: self-hosting, AI classification gate (ADR-007) |
| Access to Information Act | Public registers (Track 2) and aggregates; open-data API with small-group suppression |
