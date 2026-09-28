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
_Avoid_: employer, agency, institution

**Reporting officer**:
The person EACC assigns to a Responsible Commission to import and maintain its roster and resolve onboarding no-matches.
_Avoid_: HR focal point, admin

**EACC**:
The oversight body. Receives compliance reports and referrals; not a super-tenant.

**Applicant**:
Any person requesting access to a declaration under Form K.
_Avoid_: requester, third party

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

**Onboarding**:
The one-time process that turns a roster record into a declarant account: Commission selection, file-number match, email and phone OTP, Keycloak account.
_Avoid_: registration, sign-up, invitation

### Declaring

**Declaration**:
A submitted set of financial statements as at a statement date; initial, biennial or final.
_Avoid_: return, filing, form

**Filing obligation**:
A declarant's duty to make a specific declaration by a due date.
_Avoid_: deadline, task

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
A proposed item or field, read from a registry or a document, that the declarant can accept, edit or dismiss; never part of the declaration until accepted.
_Avoid_: pre-fill, auto-fill, recommendation

**Match key**:
A normalised identifier (registration, parcel, company number or name, KRA PIN) that says a suggestion and an existing item describe the same thing.
_Avoid_: dedupe key, fingerprint

**Item source**:
The record on an accepted item of where it came from: the registry or document, the suggestion, and when; absent for items the declarant entered.
_Avoid_: provenance, origin

### Review

**Clarification**:
A Responsible Commission's request that a declarant explain or complete a declaration (Act s.35).
_Avoid_: query, question, follow-up

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
A written request by a law enforcement agency for a declaration (Act s.36(2)).
_Avoid_: LEA request (in prose), subpoena

**Compliance report**:
Form M, a Commission's report to EACC.
_Avoid_: return, submission

**Reference number**:
The human-readable identifier of a record, e.g. `DCB-TSC-2027-0012345-K`.
_Avoid_: ID, code, ticket number
