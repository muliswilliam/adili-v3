# EACC user stories: coverage

Maps every user story in EACC's *User Stories and Workflows* document (Declaration of Income, Assets and Liabilities; Access to Declarations and Clarifications, September 2026) to our design. The source document was provided to challenge participants and isn't reproduced in this repo.

**Demo priority** (proposed, to be confirmed in the demo scope): **Must** = in the live demo journey · **Should** = built if time allows, otherwise shown as designed · **Could** = designed, on the roadmap.

## Declaration of Income, Assets and Liabilities

| # | User story | User | Our design | Service(s) | Ref | Priority |
|---|---|---|---|---|---|---|
| 1 | Register / login | Declarant | Self-onboarding: pick Responsible Commission, personnel file number + national ID matched against the imported roster, email + phone OTP to roster contacts, IPRS check, then passkey or password + MFA on Keycloakify-branded pages | Keycloak, directory, notifications | ADR-004, ADR-014 | Must |
| 2 | Confirm bio data | Declarant | Pre-filled from the Commission roster, IPRS and HR where available; declarant confirms or corrects | directory, integration-gateway | ADR-006, ADR-014 | Must |
| 3 | Select declaration type | Declarant | **Derived automatically** (initial / biennial / final) from appointment and exit events and the cycle calendar; declarant confirms | declarations | ADR-003 | Must |
| 4 | Capture spouse(s) | Declarant | Multiple spouses; pre-fill from previous declaration and HR; separated-spouse handling | declarations | - | Must |
| 5 | Capture dependent children | Declarant | Under 18 on the statement date; drop-off calculated automatically | declarations | - | Must |
| 6 | Declare income | Declarant | One financial statement per person; material-change explanation where required | declarations | ADR-001 | Must |
| 7 | Declare assets | Declarant | Typed assets (land, buildings, vehicles, investments, receivables; in Kenya or abroad; joint share); document upload with **AI pre-fill**; material-change comparison with previous declaration | declarations, documents, ai-gateway | ADR-002, ADR-007 | Must |
| 8 | Declare liabilities | Declarant | Outstanding amounts; new, settled or changed liabilities flagged | declarations | - | Must |
| 9 | Additional information | Declarant | Free text; also where material changes are recorded (Reg 21) | declarations | - | Must |
| 10 | Review declaration summary | Declarant | Completeness checks, material-change summary, solemn declaration | portal, declarations | - | Must |
| 11 | Submit declaration | Declarant | Step-up re-authentication; atomic submit with reference number (`DCB-…`) | declarations | ADR-011 | Must |
| 12 | Receive acknowledgement | Declarant / system | Signed PDF slip with QR verification, email/SMS | documents, notifications | ADR-010 | Must |
| 13 | Analyse and verify declaration | Authorised officer | Deterministic rules (completeness, ±25%, income vs assets) + registry cross-checks (KRA, NTSA, BRS, ArdhiSasa) + AI summary; flags are indicators, not findings | review, integration-gateway, ai-gateway | ADR-003, ADR-007 | Must |
| 14 | Request clarification | Authorised officer | AI-drafted, officer-edited letter (`CLR-…`); 6-month window and 30-day reply timer | review | ADR-003 | Must |
| 15 | Submit clarification response | Declarant | Response + attachments; reminders | portal, review, documents | - | Must |
| 16 | Review clarification, determine compliance | Authorised officer | Proposal + approval by a different officer (separation of duties) (`CMP-…`) | review | ADR-004 | Must |
| 17 | Issue administrative action | Authorised officer | Ladder: notice to comply → warning → salary stoppage (payroll instruction) → disciplinary (`ADM-…`) | review, integration-gateway | ADR-003, ADR-009 | Should |
| 18 | Compile compliance report (Form M) | Authorised officer | Auto-compiled from data; officer reviews and edits (`RPT-…`) | reporting | ADR-003 | Must |
| 19 | Submit compliance report to EACC | Authorised officer | Electronic submission with signed receipt; federated Commissions via API | reporting | ADR-009 | Must |
| 20 | Analyse submitted compliance reports | Processing officer (EACC) | Intake dashboard: who has reported, compliance rates, outliers, overdue Commissions | reporting | - | Must |
| 21 | Consolidate compliance reports | Processing officer (EACC) | National consolidated report (`NCR-…`) with AI-drafted narrative | reporting, ai-gateway | ADR-007 | Should |
| 22 | Report non-compliant declarants for action | Processing officer (EACC) | Referral list (`RFL-…`) sent to ICMS; ICMS case number stored | reporting, integration-gateway | ADR-009, ADR-011 | Should |

## Access to declarations and clarifications

(Numbering follows the source document, which has no story 4.)

| # | User story | User | Our design | Service(s) | Ref | Priority |
|---|---|---|---|---|---|---|
| 1 | Register / login | Applicant, law enforcement agency | Public applicants: IPRS + phone OTP. Agencies: institution-issued accounts or API clients | Keycloak | ADR-004, ADR-009 | Should |
| 2 | Initiate access request | Applicant | Form K online, purpose and legitimate interest (`ARQ-…`); agencies use the Reg 23 route (`LEA-…`) | access | ADR-009 | Should |
| 3 | Submit request, receive acknowledgement | Applicant / system | Reference number + acknowledgement | access, notifications | ADR-011 | Should |
| 5 | Analyse and review request | Authorised officer | Review queue with Reg 24 grounds checklist | access | - | Should |
| 6 | Notify affected party | Authorised officer | Declarant notified automatically, with representation window | access, notifications | ADR-003 | Should |
| 7 | Make / receive representations | Declarant / authorised officer | Representations captured in the case | access | - | Should |
| 8 | Grant access | Authorised officer | Full or partial grant; watermarked, signed, time-limited package | access, documents | ADR-010 | Should |
| 9 | Deny access | Authorised officer | Decision with reasons (Reg 24) | access | - | Could |
| 10 | Close case | Authorised officer | Final status, correspondence stored, access events logged | access, audit | ADR-008 | Could |

## Key reports required

| Report | Users | Frequency | Our design |
|---|---|---|---|
| Compliance report (initial and final declarations) | Responsible Commission | Annually | Form M, auto-compiled (reporting) |
| Compliance report (biennial declarations) | Responsible Commission | Biennially | Form M, auto-compiled (reporting) |
| Consolidated compliance report | EACC | Biennially | National consolidated report (reporting) |
| Non-compliant declarants for action | EACC | Biennially | Referral list → ICMS (reporting, integration-gateway) |

## Integrations required

| System | Purpose (per EACC) | Our design |
|---|---|---|
| ArdhiSasa | Land: owner, title number, size, location | integration-gateway adapter + Django mock |
| HR systems | Personal info, marital status, designation, file number, spouse(s), children | adapter + mock; roster file upload or roster API |
| NTSA | Vehicles: make, model, capacity, value | adapter + mock |
| BRS | Beneficial ownership: directors, shares | adapter + mock |
| NRB (IPRS) | Identity: names, ID numbers | adapter + mock; used at registration |
| KRA | PIN verification, compliance status | adapter + mock |
| ICMS | Post non-compliant officers for investigation | adapter + mock (outbound) |
| *Payroll (added)* | Salary stoppage and reinstatement (Admin Mechanisms, Aug 2026) | adapter + mock (outbound) |

## Capabilities we added beyond the user stories

| Capability | Why | Ref |
|---|---|---|
| Automatic material-change detection and "compare, don't show" across transfers | Act s.31(3)-(4); officers move between Commissions | ADR-006 |
| Verifiable documents (QR, signed PDFs, tamper check) | Counters forged EACC and Commission letters | ADR-010 |
| Human-readable reference numbers + glossary | How EACC and Commissions refer to matters | ADR-011 |
| "Who accessed my declaration" | Transparency; Reg 22(2), 23(2) notifications | ADR-008 |
| Compliance certificate + status verification API (vetting, IEBC 2027) | Appointment and election vetting | ADR-009 |
| Law enforcement, payroll, ICMS and open-data APIs | Other agencies' needs | ADR-009 |
| Public API, webhooks, conformance tests for federated Commissions | Admin Mechanism 39 | ADR-009 |
| EACC-provisioned Commissions and roster import (file or API), no mass invitations | Onboarding only against rosters the Commission vouches for; complete Form M non-filer figures | ADR-014 |
| Staggered reminders and Commission readiness dashboards | Flatten the December and 2027 peaks | ADR-003 |
| AI filing helper (English and Swahili) and reviewer copilot | Usability for 1.5M users; reviewer productivity | ADR-007 |
