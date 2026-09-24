# DIALs - Scope, Population and Scale

Research note for the Adili Online V3 challenge, Track 3 (DIALs). Researched 2026-09-24.
Sources: the COI Act 2025 and COI Regulations 2026 (in [`docs/reference/legal`](../reference/legal)), challenge materials provided by EACC to participants, and public sources listed at the end.
Numbers marked "est." are our estimates, not official figures.

## 1. Who must declare (legal scope)

| Rule | Source |
|---|---|
| **Every public officer** declares income, assets and liabilities for self, spouse(s) and dependent children under 18 | Act s.31(1) |
| "Public officer" = Constitution Art. 260: any State officer, or anyone holding an office in national govt, county govt or the public service paid from the Consolidated Fund or from money provided by Parliament. Supreme Court: Art. 260 wins over other statutory definitions | Act s.2, Art. 260 |
| Includes officers on leave, under discipline, seconded, or on overseas assignment | First Schedule note 4, Admin Mechanisms (Aug 2026) |
| Only exemption: Attorney General dispensation for an officer or category, published in the Gazette | First Schedule note 4 |
| Covers assets outside Kenya and joint assets (with the officer's share stated) | First Schedule note 13, Admin Mechanisms |
| Separated spouses included "in so far as reasonably ascertainable" | Admin Mechanisms |
| Elected officers file a final declaration at end of term **even if seeking re-election** | Admin Mechanisms |
| Former officers: final declaration within 30 days of leaving; records kept 5+ years after exit | Act s.34(3), s.37 |

So in practice: all State officers (President to MCAs, judges, commissioners) plus every public servant: national government, 47 counties, teachers, police, KDF, NIS, parastatals, state-owned companies, public universities, and staff of other reporting entities paid with public money.

**Grey area to raise with EACC:** the Act's "reporting entity" list (s.2) is broader than Art. 260 "public office" (for example PPP bodies, entities spending public money, school Board of Management staff). The system should treat "is this person a declarant?" as **configurable, per category**, not hard-coded.

## 2. Who receives declarations (tenants)

Declarations go to the officer's **responsible Commission** (s.32, Reg 5). EACC oversees and analyses; it is not the receiver (except for its own staff).

| Responsible Commission | Declarants | Count |
|---|---|---|
| National Assembly ethics committee | Cabinet, MPs, DPP, SCAB, JSC members, Ch.15 commissioners, EACC Deputy Director and above | 1 |
| Senate ethics committee | Senators | 1 |
| County assembly ethics committees | CECs, MCAs, CPSB members | 47 |
| Public Service Commission | PSs, ambassadors, national public servants, state corporation staff, ODPP/CoB/OAG staff, **catch-all for anyone unassigned** (Reg 5(f)) | 1 |
| County Public Service Boards | County staff, county corporations | 47 |
| Judicial Service Commission | Judges, magistrates, judiciary staff | 1 |
| Parliamentary Service Commission | Parliament staff | 1 |
| County Assembly Service Boards | County assembly staff | 47 |
| Teachers Service Commission | Teachers | 1 |
| Defence Council | KDF | 1 |
| NIS Council | NIS | 1 |
| National Police Service Commission | Police | 1 |
| Witness Protection Advisory Board | WPA staff | 1 |
| EACC | Own staff below Deputy Director | 1 |
| Commission for University Education | Public university staff and councils | 1 |
| CBK Board | CBK and state-owned banks | 1 |
| Other Art. 248(2) commissions (KNCHR, NLC, IEBC, CRA, SRC) | Own employees | ~5 |
| **Total** | | **~160** |

Plus **delegation**: PSC may delegate DIALs for officers below job group "M" to other bodies by Gazette notice (s.33), and EACC may delegate functions to reporting authorities (s.7(c), Reg 4). The body that holds disciplinary control stays responsible even after delegating (s.32(16)).

**Design implications**
- Tenant = responsible Commission. Hierarchy: Commission → delegated body → reporting entity (employer) → department / work station.
- **The officer's employer and the officer's reviewer are different axes.** A teacher works at a public school (reporting entity) but files with TSC. Model both.
- **Declaration history follows the person (national ID), not the tenant.** People transfer, get seconded, move from county to national service, or get elected. Material-change detection (s.31(3)-(4)) needs the previous declaration, even if another Commission holds it. That needs controlled, audited cross-tenant access.
- Admin Mechanism 39 gives Commissions three options: EACC modular system, EACC-hosted multi-tenant platform, or their own system following EACC guidelines. So we need **one platform plus a published schema/API** so Commissions with their own systems can still file Form M and exchange declarations.

## 3. Population (who files)

KNBS Economic Survey 2026, public sector wage employment in 2025:

| Segment | Employees 2025 | Responsible Commission |
|---|---|---|
| Teachers Service Commission | 436,300 | TSC |
| Ministries + extra-budgetary institutions | 243,500 | PSC (and delegates) |
| County governments | 239,000 | 47 CPSBs / assembly boards / assembly committees |
| Parastatals | 101,400 | PSC, CUE, CBK board, etc. |
| Other (majority-owned companies etc., by subtraction) | ~49,800 | PSC (catch-all) |
| **KNBS public sector total** | **1,070,000** (up from 1,023,200 in 2024) | |

Probably **outside or only partly inside** the KNBS figure (need to confirm):

| Segment | Size | Note |
|---|---|---|
| National Police Service | ~106,500 in post (establishment 306,590) | NPSC |
| KDF | est. 25,000-75,000 (sources disagree) | Defence Council |
| NIS | not public | NIS Council |
| Elected State officers | ~2,700 (349 MPs, 67 Senators, 47 Governors + deputies, ~2,200 MCAs incl. nominated) | Ethics committees |
| Judges and magistrates | ~1,550 (2022) | JSC |
| Board / council members, interns, contract staff | unknown | various |

**Sizing**
- Declarants now: **~1.2-1.3M** (est.)
- Design target: **1.5M declarants**, headroom for **10x burst load**
- Financial statements per cycle: one each for the officer, each spouse and each dependent child. At ~3 per declarant (est.) that's **~4-5M statements per biennial cycle**
- Workforce is growing ~4.6% a year (+47k jobs in 2025), with more teacher and police hiring announced

## 4. When load arrives (calendar)

| Event | Rule | Volume (est.) |
|---|---|---|
| **Biennial** | Statement date 1 Nov; file 1 Nov - 31 Dec in odd years (2025 done, **next Dec 2027**) | ~1.2-1.5M declarations in ~60 days, most in the last week |
| Initial | Within 30 days of appointment, covering the year before appointment | ~60-100k a year (hires + replacements); spikes in teacher and police intakes |
| Final | Within 30 days of leaving | ~30-60k a year; PSC alone reported 9,665 exits from 287 institutions last year; retirement wave (~25-30k civil servants aged 56+) |
| Clarifications | Commission may request within 6 months of receipt; officer has 30 days to reply | Jan-Jun after each biennial cycle |
| Form M (Commission → EACC) | By 31 July (biennial: the year after the declaration year; initial/final: after financial year end) | ~160 reports + EACC consolidation |
| Referral | 2 consecutive missed cycles or unanswered clarifications → EACC | |

**2027 is a triple peak**, which is a strong scalability story for the pitch:
1. **By 9 Feb 2027:** public officers running for office must resign → wave of final declarations
2. **10 Aug 2027 general election:** final declarations for every outgoing elected officer (even if re-elected) and initial declarations for every new MP, Senator, Governor, MCA, CEC and new political appointee
3. **1 Nov - 31 Dec 2027:** full national biennial cycle

**The real load is concurrent drafting, not submissions:** 100k open forms autosaving every 30s is ~3,000+ writes/s. Submissions stay in the single digits to tens per second.

## 5. Data volume (est.)

| Data | Per cycle |
|---|---|
| Structured declaration data (JSON, with history and versions) | ~250GB |
| Supporting documents (~5 files per declarant, ~1MB each) | ~7-10TB |
| Audit events (every read and write) | billions of rows over 5+ years; partition and archive |
| Retention | 5+ years after the officer leaves (s.37), so effectively decades for career officers |

## 6. What the DIALs system must do (every document combined)

Checklist for our feature scope and the pitch's requirement map. "AM" = Administrative Mechanisms slide 12 (para 37).

**Declarant**
- [ ] Secure login; reuse existing institutional credentials (User story 1)
- [ ] Bio data pre-filled from HR and IPRS, then confirmed: names, KRA PIN, ID, personal file no., DOB, nationalities, gender, marital status, addresses, employment, job group, appointment dates, work station, nature of employment (User story 2)
- [ ] Declaration type: initial, biennial or final. **The system should derive it** from appointment/exit events and the cycle calendar, not rely on the user picking correctly (US 3, s.34)
- [ ] Spouse(s): names, ID, KRA PIN, occupation (public/private). Separated spouse handling (US 4, Admin Mechanisms)
- [ ] Dependent children under 18; auto-drop at 18 based on the statement date (US 5)
- [ ] **A separate financial statement for each person** (officer, each spouse, each child) with statement date and period (First Schedule para 8)
- [ ] Income, assets (typed, with location, in Kenya or abroad, joint share) and liabilities, each with a material-change explanation (US 6-8, s.31(3))
- [ ] Material change detection: ±25% value, acquisition or disposal, marital status, directorships, company/partnership membership, club/society/trust membership (s.31(4))
- [ ] Other relevant information (para 9; Reg 21 says material changes are recorded here)
- [ ] Review summary, solemn declaration, electronic submission with no signature or witness needed (US 10-11, First Schedule notes 1 and 12)
- [ ] Acknowledgement slip / receipt (US 12, note 11, AM c)
- [ ] Reminders and notifications (AM a)
- [ ] Respond to clarification with attachments within 30 days (US 15, s.35(3))
- [ ] See own history; get notified when someone asks to access your declaration and make representations (s.36(3), Reg 22(2), Reg 23(2))

**Responsible Commission**
- [ ] Analyse: completeness, discrepancies or inconsistencies, possible conflict-of-interest issues (s.35(1), AM d)
- [ ] Compare against other sources: land, vehicles, companies, tax, ID (Reg 20(1)(b), AM e)
- [ ] Request clarification within the 6-month window; track the 30-day reply (US 14, s.35(2))
- [ ] Decide compliant / non-compliant / further action (US 16)
- [ ] Administrative actions: notice to comply → warning → **salary stoppage pending compliance** → disciplinary proceedings → other (US 17, Admin Mechanisms). Salary stoppage means an **integration back to payroll/HR**
- [ ] Refer undeclared or unexplained assets to EACC; auto-refer after 2 missed cycles (Reg 20(1)(c), 20(2))
- [ ] Form M compliance report, compiled automatically, signed off, sent electronically by 31 July (US 18-19, Reg 25(2)-(3))
- [ ] Roster management: who must file, appointments and exits (needed to compute non-filers)

**EACC**
- [ ] Receive and analyse Form M from ~160 Commissions (US 20)
- [ ] National consolidated report (US 21)
- [ ] Non-compliant declarants report; send to ICMS for investigation (US 22)
- [ ] Forfeiture proceedings for undeclared/unexplained assets (s.6(i)): supply evidence packs
- [ ] Clear distinction between non-submission, incomplete submission, reported non-compliance, risk indicator, verified finding and referral. Analytics support professional judgement and never count as proof of wrongdoing (Agenda Track 6)

**Access to declarations (Form K)**
- [ ] Applicant registers and files Form K showing legitimate interest and good cause; gets a reference number (Access US 1-3, s.36(1), Reg 22)
- [ ] Commission reviews and notifies the declarant, who can make representations (Access US 5-7, s.36(3))
- [ ] Grant (full or partial, with scope and manner) or deny with reasons from Reg 24 (Access US 8-9)
- [ ] Law enforcement route without Form K, written reason, declarant notified (Reg 23)
- [ ] Close the case, log access events (Access US 10); republishing without permission is an offence (s.36(4)), so watermark and trace every disclosure

**Cross-cutting**
- [ ] Confidentiality and integrity, secure retention and retrieval (AM h-i, s.46)
- [ ] Least privilege, separation of duties; help-desk and admin staff **with no access to financial content** (Track 3 users)
- [ ] Tamper-evident audit trail, including reads
- [ ] Integrations: ArdhiSasa (land), HR systems, NTSA (vehicles), BRS (companies/directors), IPRS (ID), KRA (PIN/compliance), ICMS (EACC case system) (Users & Workflows doc), plus payroll for salary stoppage
- [ ] Accessibility and inclusion, for over a million users of all digital skill levels (Agenda)
- [ ] Fictional demo accounts for every role; hosted prototype, deploy instructions, demo backup (Agenda)

## 7. Discrepancies and open questions for EACC mentors

1. **Art. 260 vs reporting entity scope:** do staff of PPP bodies or school Boards of Management file?
2. **Witness signature** on the First Schedule form vs electronic filing without signature: confirm electronic needs no witness.
3. **Initial declaration period:** s.34(1) says "one year prior to appointment"; guideline 6 says the statement date is the appointment date. Confirm the income period is the 12 months before that date.
4. **Securities threshold:** 10% (Reg 17) applies to the COI register (Track 2). Does DIALs also use it, or declare every holding?
5. **Cross-tenant history:** may a new responsible Commission see declarations filed with the previous one, for material-change comparison?
6. **ICMS and payroll:** interface specs, or do we mock both?
7. Agenda typo: Phase 1 says "10 Sep - 21 Sep", Stage 2 says 23 Sep - 2 Oct.

## Sources

- [Conflict of Interest Act 2025](../reference/legal/conflict-of-interest-act-2025.pdf); [Conflict of Interest Regulations 2026 (LN 53/2026)](../reference/legal/conflict-of-interest-regulations-2026-ln53.pdf)
- Challenge materials provided to participants (not in this repo): Adili Online V3 Challenge Agenda Rev.2; EACC "Users and Workflows - COI" (Sep 2026); EACC "Overview of the Conflict of Interest Act, 2025" presentation (21 Sep 2026)
- [KNBS 2026 Economic Survey](https://www.knbs.or.ke/reports/2026-economic-survey/) / [PDF](https://www.knbs.or.ke/wp-content/uploads/2026/04/2026-Economic-Survey.pdf)
- [Kenya Times - KNBS sector employment](https://thekenyatimes.com/jobs-careers/top-private-and-public-sector-industries-employing-kenyans/)
- [Kenyan Wallstreet - Economic Survey 2026 highlights](https://kenyanwallstreet.com/economic-survey-2026-highlights)
- [KLRC - Constitution Art. 260](https://www.klrc.go.ke/index.php/constitution-of-kenya/161-chapter-seventeen-general-provisions/429-260-interpretation)
- [Pulse - EACC new COI rules (Admin Mechanisms, Aug 2026)](https://www.pulse.co.ke/story/eacc-sets-out-new-conflict-of-interest-rules-2026081906360679845)
- [Kenyans.co.ke - EACC new wealth declaration rules](https://www.kenyans.co.ke/news/126312-eacc-sets-new-rules-wealth-declarations-and-conflicts-interest-public-officers)
- [Education News - EACC tightens rules ahead of 2027](https://educationnews.co.ke/eacc-tightens-wealth-conflict-of-interest-rules-for-public-officers-ahead-of-2027/)
- [Daily Nation - EACC activates COI law](https://nation.africa/kenya/news/tough-rules-for-public-officials-politicians-as-eacc-activates-conflict-of-interest-law--5266134)
- [EACC - DIALs implementation (2019: 3 of 20+ Commissions had procedures)](https://eacc.go.ke/default/government-officers-empowered-to-manage-declarations-of-income-assets-and-liabilities/)
- [Streamline - NPS 106,469 officers vs 306,590 establishment](https://streamlinefeed.co.ke/news/eacc-probe-reveals-police-service-faces-200000-officer-shortfall)
- [Wikipedia - Kenya Defence Forces](https://en.wikipedia.org/wiki/Kenya_Defence_Forces), [DefenceWeb - KDF profile](https://defenceweb.co.za/land/land-land/african-military-profile-kenya/)
- [KIPPRA - judiciary staffing](https://kippra.or.ke/promoting-timely-service-delivery-in-the-judicial-system/)
- [Streamline - PSC exits and ageing workforce](https://streamlinefeed.co.ke/news/grey-hair-crisis-psc-seeks-sh3bn-to-replace-aging-civil-servants)
- [The Star - IEBC confirms 10 Aug 2027 election](https://www.the-star.co.ke/news/2026-06-24-iebc-confirms-august-10-as-date-for-2027-general-election), [Mwango Capital - resignation deadline 9 Feb 2027](https://x.com/MwangoCapital/status/2070001548831424590)
- [Khusoko - state corporation mergers](https://khusoko.com/2025/01/22/kenya-merges-42-parastatals-to-cut-costs-boost-efficiency/)
