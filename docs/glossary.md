# Adili Online DIALs - Glossary

Seed content for the in-app glossary, reference-number tooltips and the public help centre (see [ADR-011](adr/0011-human-readable-reference-numbers.md)). The live source of truth will be the numbering scheme registry and reference data; this file seeds it. Swahili translations to be added and reviewed by EACC.

## How to read a reference number

`DCB-TSC-2027-0012345-K`

| Part | Example | Meaning |
|---|---|---|
| Type | `DCB` | What the record is (see Type codes) |
| Issuer | `TSC` | The Commission or body that issued it (see Issuer codes) |
| Period | `2027` | Declaration year, financial year end (Form M), or year created |
| Sequence | `0012345` | Running number for this type, issuer and period |
| Check | `K` | Check character that catches typing mistakes |

## Type codes

| Code | Name | Description | Legal basis |
|---|---|---|---|
| `DCI` | Initial declaration | Declaration made within 30 days of appointment, covering the year before appointment. The number is also the acknowledgement receipt number. | Act s.34(1) |
| `DCB` | Biennial declaration | Declaration made every two years, with a statement date of 1 November and filed by 31 December. The number is also the acknowledgement receipt number. | Act s.34(2) |
| `DCF` | Final declaration | Declaration made within 30 days of leaving public office. The number is also the acknowledgement receipt number. | Act s.34(3) |
| `CLR` | Clarification request | A Commission's written request for missing information or an explanation of an inconsistency. The officer must reply within 30 days. | Act s.35 |
| `CMP` | Compliance determination | The Commission's decision on whether a declaration is compliant, non-compliant or needs further action. | Act s.35; Regs r.20 |
| `ADM` | Administrative action | Action for non-compliance: notice to comply, warning, salary stoppage pending compliance, disciplinary proceedings. | Admin Mechanisms (2026) |
| `ARQ` | Access request | A request by any person to see a declaration or clarification (Form K). | Act s.36(1); Regs r.22 |
| `LEA` | Law enforcement request | A written request by a law enforcement agency to access a declaration. | Act s.36(2); Regs r.23 |
| `RPT` | Compliance report | A Commission's compliance report to EACC (Form M), due by 31 July. | Regs r.25(2) |
| `NCR` | National consolidated report | EACC's national report built from all Commissions' compliance reports. | Act s.6; Users & Workflows US 21 |
| `RFL` | Referral | A matter sent to EACC for investigation, e.g. undeclared or unexplained assets, or two missed cycles. | Regs r.20(1)(c), r.20(2) |
| `CRT` | Compliance certificate | A certificate an officer can download to prove their declaration status. | Adili Online (ADR-009) |
| `DLG` | Delegation | A record of powers delegated to another body, e.g. by the Public Service Commission for officers below job group M. | Act s.7(c), s.33; Regs r.4 |
| `OFR` | Officer reference | A permanent number for each officer, used instead of the national ID when contacting the helpdesk. | Adili Online |

## Issuer codes (responsible Commissions)

| Code | Body | Responsible for |
|---|---|---|
| `NAETH` | National Assembly ethics committee | Cabinet, MPs, DPP, Secretary to the Cabinet, JSC members, commissioners, EACC Deputy Director and above (s.32(2)) |
| `SNETH` | Senate ethics committee | Senators (s.32(3)) |
| `CAETH001`-`CAETH047` | County assembly ethics committees | County executive committee members, MCAs, County Public Service Board members (s.32(4)) |
| `PSC` | Public Service Commission | Principal Secretaries, ambassadors, national public servants, state corporation staff, staff of ODPP, Controller of Budget and Auditor-General; anyone not assigned elsewhere (s.32(5); Regs r.5(e)-(f)) |
| `CPSB001`-`CPSB047` | County Public Service Boards | County public servants and county corporations (s.32(6)) |
| `JSC` | Judicial Service Commission | Judges, magistrates and judiciary staff (s.32(7)) |
| `PARLSC` | Parliamentary Service Commission | Parliament staff (s.32(8)) |
| `CASB001`-`CASB047` | County Assembly Service Boards | County assembly staff (s.32(9)) |
| `TSC` | Teachers Service Commission | Registered teachers (s.32(10)) |
| `DC` | Defence Council | Kenya Defence Forces (s.32(11)) |
| `NISC` | National Intelligence Service Council | NIS members (s.32(12)) |
| `NPSC` | National Police Service Commission | Police officers (s.32(13)) |
| `WPAB` | Witness Protection Advisory Board | Witness Protection Agency staff (s.32(14)) |
| `EACC` | Ethics and Anti-Corruption Commission | EACC staff below Deputy Director (Regs r.5(a)) |
| `CUE` | Commission for University Education | Public university staff and council members (Regs r.5(b)) |
| `CBK` | Central Bank of Kenya Board | CBK and state-owned bank staff (Regs r.5(c)) |
| `KNCHR`, `NLC`, `IEBC`, `CRA`, `SRC` | Constitutional commissions (Art. 248(2)) | Their own employees (Regs r.5(d)) |

County codes 001-047 follow the standard Kenyan county numbering (e.g. 047 = Nairobi City).

## Key terms

| Term | Meaning |
|---|---|
| **DIALs** | Declaration of Income, Assets and Liabilities. |
| **Declarant** | A public officer who must make a declaration. |
| **Public officer** | Any State officer or person holding a public office paid from public funds (Constitution Art. 260). |
| **Responsible Commission** | The body that receives and reviews an officer's declarations (Act s.32). |
| **Reporting entity** | The public body an officer works for, e.g. a ministry, county, state corporation, school or university (Act s.2). |
| **Statement date** | The date the financial position is declared as at: appointment date (initial), 1 November (biennial), exit date (final). |
| **Financial statement** | The income, assets and liabilities of one person. A declaration has one each for the officer, each spouse and each dependent child under 18. |
| **Material change** | A change of at least 25% in value; buying or disposing of an asset or liability; change in marital status; change in directorships or memberships (Act s.31(4)). |
| **Clarification** | A Commission's request to explain or complete a declaration (Act s.35). |
| **Administrative action** | A sanction for non-compliance, up to salary stoppage and disciplinary proceedings (Admin Mechanisms, 2026). |
| **Form K** | The prescribed form to request access to a declaration (Regs r.22). |
| **Form M** | The prescribed compliance report from a Commission to EACC (Regs r.25(2)). |
| **Verification code** | The code under a document's QR code, used to check the document is genuine (ADR-010). |
| **Reference number** | The human-readable number of a record, e.g. `DCB-TSC-2027-0012345-K` (ADR-011). |
