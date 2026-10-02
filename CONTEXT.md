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

**Acknowledgement slip**:
The signed PDF receipt issued for each submitted version of a declaration, carrying its reference number, version, submission time, verification code and QR code; a later version's slip supersedes it.
_Avoid_: receipt (alone), certificate, confirmation

**Verification code**:
The random, unguessable identifier of an issued document's verification record, printed under its QR code (e.g. `ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K`), with which anyone can check that the document is genuine and current.
_Avoid_: reference number, document ID, serial

### Review

**Clarification**:
A Responsible Commission's request that a declarant explain or complete a declaration (Act s.35).
_Avoid_: query, question, follow-up

**Clarification item**:
One thing a clarification asks: the section, person or item it concerns, what Act s.35(4) requires (provide omitted information, explain a discrepancy, or correct the entry) and the Commission's text. The declarant answers each one. Portal copy calls it a "point" ("Point 2 of 3"); the console and the contract say "item".
_Avoid_: question

**Further clarification**:
A clarification raised on the response to an earlier one, recorded as `followUpOf`. The console action is "Raise follow-up", after the contract's `/follow-up` operation; that is the one place "follow-up" is used. The declarant sees "further clarification".
_Avoid_: follow-up (for the clarification itself)

**Compliance determination**:
The decision that a declaration is compliant, non-compliant or needs further action.
_Avoid_: verdict, outcome, approval

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

**Certified copy**:
A signed, full copy of one submitted version of a declarant's own declaration, issued to the declarant or their representative on a self-access application (Administrative Mechanism 32).
_Avoid_: duplicate, printout, access package

**Compliance report**:
Form M, a Commission's report to EACC.
_Avoid_: return, submission

**Reference number**:
The human-readable identifier of a record, e.g. `DCB-TSC-2027-0012345-A`.
_Avoid_: ID, code, ticket number
