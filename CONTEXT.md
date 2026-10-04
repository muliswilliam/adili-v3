# DIALs

Declaration of Income, Assets and Liabilities under the Conflict of Interest Act 2025: public officers declare to their Responsible Commission, which reviews and reports compliance to EACC.

## Language

### People and bodies

**Declarant**:
A public officer who must make a declaration.
_Avoid_: user, officer (alone), filer

**Responsible Commission**:
The body that receives and reviews a declarant's declarations (Act s.32). Also the tenant.
_Avoid_: RC (in prose), employer, organisation

**Reporting entity**:
The public body a declarant works for. Used for categorisation only; it never accesses declarations.
_Avoid_: employer, agency (that word is kept for a law enforcement agency), institution

**Reporting officer**:
The person EACC assigns to a Responsible Commission to import and maintain its roster and resolve onboarding no-matches.
_Avoid_: HR focal point, admin

**EACC**:
The oversight body. Receives compliance reports and referrals; not a super-tenant.

**Applicant**:
Any person requesting access to a declaration under Form K. Has an account of their own, tied to no Responsible Commission, made by applicant onboarding.
_Avoid_: requester, third party

**Law enforcement agency**:
A body empowered to ask for a declaration for an investigation (Act s.36(2)), e.g. the DCI or ODPP, registered on the platform with the legal basis it acts under. Say "agency" alone only where the law enforcement context is clear.
_Avoid_: LEA (in prose), authority, reporting entity

**Law enforcement officer**:
A person provisioned by a platform admin with an account for one law enforcement agency, who files law enforcement requests with any Responsible Commission and sees only their own. Neither a declarant nor staff of a Commission.
_Avoid_: investigator, LEA user, officer (alone)

### Onboarding

**Roster**:
A Responsible Commission's list of expected declarants, imported by file or API.
_Avoid_: staff list, payroll, directory

**Roster record**:
One row of a roster: personnel file number, identity and employment details. A declarant onboards against exactly one.
_Avoid_: employee, entry

**Personnel file number**:
The identifier a Responsible Commission uses for an officer; the onboarding match key.
_Avoid_: staff number, PF, employee ID

**Roster exit**:
The confirmed departure from office of a roster record's declarant, as at an exit date. It owes a final declaration.
_Avoid_: termination, removal, offboarding

**Onboarding**:
The one-time process that turns a roster record into a declarant account: Commission selection, file-number match, email and phone OTP, Keycloak account. Unqualified, it always means a declarant's.
_Avoid_: registration, sign-up, invitation

**Applicant onboarding**:
The one-time process that makes an applicant account, with no roster record: identity document (a national ID checked with IPRS, or a passport an access officer verifies later), names, phone OTP, email, Keycloak account.
_Avoid_: registration, sign-up, onboarding (alone)

### Declaring

**Declaration**:
A submitted set of financial statements as at a statement date; initial, biennial or final.
_Avoid_: return, filing, form

**Filing obligation**:
A declarant's duty to make a specific declaration by a due date.
_Avoid_: deadline, task

**Cycle opening**:
The day a biennial cycle's filing obligations are created for every declarant on a roster, a set number of days (120 by default) before its statement date.
_Avoid_: cycle start, launch

**Obligations policy**:
A Responsible Commission's versioned rules for filing obligations: the statutory periods, the reminder schedule and the obligations start date, before which no declaration is owed on Adili.
_Avoid_: settings, configuration, tenant policy (in prose)

**Reminder**:
A message to a declarant by SMS and email a set number of days before a filing obligation's due date, recorded with its outcome whether it was sent or skipped.
_Avoid_: notification (alone), alert, nudge

**Statement date**:
The date the financial position is declared as at.
_Avoid_: as-of date, cut-off

**Financial statement**:
The income, assets and liabilities of one person: the declarant, a spouse or a dependent child.
_Avoid_: section, schedule

**Material change**:
A change meeting Act s.31(4): 25% or more in value, acquisition or disposal, marital status, directorships or memberships.
_Avoid_: significant change, delta

**Suggestion**:
An item (or a person's tax fields) proposed for the declarant to accept, edit and accept, or dismiss, from a registry they asked to be checked or a document they attached; nothing enters the declaration until they accept it, and the item then carries its source.
_Avoid_: pre-fill (for the item), insertion, recommendation

**Reading (Read into the form)**:
An attached document (title deed, logbook, payslip, bank letter, share certificate) read by AI into the fields of the item it is attached to, each with a confidence and page, offered as one suggestion the declarant checks field by field. Gated by the Commission's AI policy ("not enabled" otherwise).
_Avoid_: extraction (in UI copy), OCR, scan, import

**Acknowledgement slip**:
The signed PDF receipt issued for each submitted version of a declaration, carrying its reference number, version, submission time, verification code and QR code; a later version's slip supersedes it.
_Avoid_: receipt (alone), certificate, confirmation

**Verification code**:
The random, unguessable identifier of an issued document's verification record, printed under its QR code (e.g. `ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K`), with which anyone can check that the document is genuine and current.
_Avoid_: reference number, document ID, serial

### Review

**Registry check**:
The comparison of a declaration's items with what KRA, NTSA, BRS and ArdhiSasa hold for each person whose national ID is known (Regs r.20(1)(b)), run when the declaration is processed. Each person has a status per registry: matched, mismatched, unavailable, not checked, or no ID. Mismatches are flags: indicators, never findings.
_Avoid_: verification (that is the gateway's stored lookup), registry audit

**Re-check**:
A registry check run again for a case: asked for by its assignee or a supervisor (at most every ten minutes), or by the hourly sweep of cases with a registry unavailable. A flag the re-check no longer raises is closed as superseded by the re-check; a reviewed one keeps its note.
_Avoid_: refresh, re-verification

**Paused registry**:
A registry a platform administrator stopped the gateway from calling during a known outage: its lookups are unavailable (reason paused) until it is resumed, answers already cached still serve.
_Avoid_: disabled, switched off

**Clarification**:
A Responsible Commission's request that a declarant explain or complete a declaration (Act s.35).
_Avoid_: query, question, follow-up

**Clarification item**:
One thing a clarification asks: the section, person or item it concerns, what Act s.35(4) requires (provide omitted information, explain a discrepancy, or correct the entry) and the Commission's text. The declarant answers each one. Portal copy calls it a "point" ("Point 2 of 3"); the console and the contract say "item".
_Avoid_: question

**Letter language**:
The language a clarification letter is issued in, English or Swahili, chosen by the reviewer. The letter's own text (heading, introduction, item labels, requirements, how to respond) is printed in it; the reviewer's text is printed as written. Draft with AI drafts in it. The contract calls it `language` (`LetterLanguage`).
_Avoid_: locale

**Further clarification**:
A clarification raised on the response to an earlier one, recorded as `followUpOf`. The console action is "Raise follow-up", after the contract's `/follow-up` operation; that is the one place "follow-up" is used. The declarant sees "further clarification".
_Avoid_: follow-up (for the clarification itself)

**Risk flag**:
An indicator computed by a fixed rule that points a reviewer at part of a declaration to check. It is never a compliance determination.
_Avoid_: finding, red flag, alert

**Compliance determination**:
The decision that a declaration is compliant, non-compliant or needs further action.
_Avoid_: verdict, outcome, approval, finding

**Administrative action**:
A sanction for non-compliance, from notice to comply up to disciplinary proceedings.
_Avoid_: penalty, enforcement

**Referral**:
A matter sent to EACC for investigation.
_Avoid_: escalation, report (alone)

### Access

**Access request**:
A Form K request to see a declaration or clarification (Act s.36(1)).
_Avoid_: FOI request, disclosure request

**Law enforcement request**:
A written request by a law enforcement agency for a declaration (Act s.36(2)), filed by one of its law enforcement officers.
_Avoid_: LEA request (in prose), subpoena

**Access package**:
The signed PDF a granted access request or law enforcement request delivers: the declarations in scope, cut to the granted years, household members and sections, watermarked with its recipient and downloadable by them for a limited window.
_Avoid_: disclosure (for the document), export, report

**Nil letter**:
The signed letter a granted access request or law enforcement request delivers instead of an access package when the Commission holds no declaration within the granted scope; watermarked with its recipient and downloadable by them for the same window.
_Avoid_: empty package, no-package notice

**Scope preview**:
The access officer's view, before deciding, of how much a scope holds of the declarant's declarations: counts per declaration year, section, household member kind and clarifications, never their content; audited like a disclosure.
_Avoid_: draft package, disclosure preview

**Certified copy**:
A signed, full copy of one submitted version of a declarant's own declaration, issued to the declarant or their representative on a self-access application (Administrative Mechanism 32).
_Avoid_: duplicate, printout, access package

**Compliance report**:
Form M, a Commission's report to EACC.
_Avoid_: return, submission

**Reference number**:
The human-readable identifier of a record, e.g. `DCB-TSC-2027-0012345-A`.
_Avoid_: ID, code, ticket number

### National reporting

**National consolidated report**:
EACC's yearly report built from every Commission's compliance report: aggregates, a narrative and an approval. Short form NCR.
_Avoid_: national report (alone), annual report

**Aggregate key**:
The stable name of one figure in the NCR aggregates, such as one Commission's non-filer rate in a given year; what a narrative paragraph cites.
_Avoid_: metric ID, field

**Pattern candidate**:
A notable pattern computed deterministically from this and prior years' aggregates, such as a rate that doubled or a Commission late three years running. The NCR's Findings section is written from candidates; AI narrates them and never finds its own.
_Avoid_: insight, pattern (alone)

**AI draft**:
A narrative paragraph written by AI that the EACC analyst drafting the NCR has not yet edited. Editing it makes it EACC's own text.
_Avoid_: suggestion, AI text

**Open-data release**:
A versioned public dataset of a financial year's aggregates (six tables, JSON and CSV, each with its SHA-256) built from the NCR or the live projections. It is a preview until an EACC supervisor publishes it, except the year's first annual release, which is published on NCR approval. A published release can be withdrawn with a reason; a corrected one is the next version, built as a preview and published deliberately.
_Avoid_: export, dump, open data (alone, for a release)

**Suppression**:
Hiding an open-data figure that counts fewer officers than the threshold (10), so that no small group of officers can be identified. The figure is published as `null` with a marker and shown as "‹10". A published total is never recomputed from the visible cells, and a total can itself be suppressed.
_Avoid_: redaction, masking

**Complementary suppression**:
Hiding a further figure, which may count 10 or more officers, wherever a single suppressed figure could otherwise be worked out from a published total by subtraction.
_Avoid_: secondary masking

### Assistance

**Ask Adili**:
The declarant's filing helper: answers questions on the law and the form from the legal corpus, in English or Kiswahili, and writes hints for what is still missing. It knows where the declarant is, never what they wrote.
_Avoid_: chatbot, assistant (alone), AI helper

**Legal corpus**:
The Act, the Regulations, the Administrative Mechanisms and help articles, as citable passages with effective dates. Ask Adili answers only from it.
_Avoid_: knowledge base, documents

**Passage**:
One citable unit of the legal corpus, such as `Act s.31` or `Regs r.21`, with its id, citation and text.
_Avoid_: chunk, snippet, source

**Completeness residual**:
What the completeness check still reports on a draft: the section, the rule and the field path, never the value.
_Avoid_: error, missing field, gap

**Hint**:
A one-line plain-language rephrasing of a completeness residual on the summary page, linked to its field. It sits beneath the deterministic text, which stays.
_Avoid_: tip, suggestion

**Decline**:
Ask Adili's answer when the passages do not support one: no answer, and the declarant is pointed to their reporting officer. An answer that cites what it was not given is replaced by a decline.
_Avoid_: refusal (that is the model's), fallback
