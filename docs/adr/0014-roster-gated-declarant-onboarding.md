# ADR-014: Roster-gated declarant onboarding

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Adili V3 DIALs team, product team
- **Supersedes:** [ADR-004](0004-identity-keycloak-self-registration.md) decision points 2 (verified self-registration) and 3 (optional rosters). The rest of ADR-004 still stands.
- **Related:** [ADR-006](0006-multi-tenancy-and-hierarchy.md), [ADR-009](0009-api-first-interoperability.md), [flowcharts](../requirements/dials-flowcharts.html) (Flowchart 1)

## Context

ADR-004 let declarants register themselves with an IPRS identity check and an unverified employment claim, and treated Commission rosters as optional auto-verification. The product team has since decided on a different onboarding process:

1. EACC creates the Responsible Commissions and assigns each one a reporting officer.
2. Each Commission imports its declarant roster, by file upload or through an API where one exists. No mass invitations are sent to declarants.
3. A declarant starts self-onboarding by selecting their Responsible Commission.
4. They enter their personnel file number, which is matched against that Commission's imported roster.
5. They verify their email with an OTP, then their phone with an OTP.
6. They complete their profile and account setup through Keycloak-managed authentication.
7. Once onboarded, they go on to the declaration workflow.
8. Reporting entities (e.g. schools under TSC) are kept for categorisation but do not access declarations.

This removes the unverified-claim problem of ADR-004 (anyone could claim any employer or Commission) and gives every Commission a complete list of expected declarants from day one, which Form M non-filer figures need (Regs r.25(2)).

## Decision

1. **Commissions are created by EACC.** A platform admin at EACC creates each Responsible Commission (tenant, ADR-006), with its categories of officers and delegations, and assigns its **reporting officer**. The reporting officer is invited individually and gets a Keycloak account with mandatory MFA.
2. **Rosters are mandatory and come first.** The reporting officer imports the roster:
   - **File upload** against a published template (CSV/Excel), or
   - **Roster API** (ADR-009, `roster:write` scope) where the Commission has an HR system.
   - Each row: personnel file number, names, national ID, designation, job group, reporting entity, appointment date, email, phone.
   - Rows are validated (required fields, formats, personnel file number unique within the Commission) and an import report lists rejected rows with reasons.
   - The roster is kept current through re-imports or API sync: appointments, exits, transfers.
3. **No mass invitations.** Importing a roster does not message declarants. Commissions announce the platform through their own channels; declarants come to it themselves.
4. **Declarant self-onboarding**, owned by the directory service and rendered by the portal:
   1. Select the Responsible Commission from the list of active Commissions.
   2. Enter the personnel file number. The directory matches it against that Commission's roster.
      - No match: a neutral message telling the declarant to contact their Commission's reporting officer. The response never confirms whether a file number exists.
      - Already onboarded: sent to login and account recovery.
      - Matching is rate-limited per IP and per Commission.
   3. Verify email with an OTP, then phone with an SMS OTP (notifications service).
   4. The directory creates the Keycloak user through the Admin API, linked to the roster record (`roster_record_id` and tenant membership). The declarant confirms their details from the roster and sets a password or passkey and MFA on Keycloakify pages.
   5. The roster record becomes **onboarded**, the officer reference (`OFR`) is issued and filing obligations are created.
5. **One account per roster record.** The link is unique. A person on two rosters (e.g. during a transfer) keeps one account; their person record (ADR-006) links to both employments.
6. **Reporting officers resolve exceptions.** Missing or wrong roster records are fixed by the reporting officer (add or correct the row); the declarant then retries. There is no employment-claim queue.
7. **Reporting entities are categorisation only.** They stay in the org tree and on roster rows for filtering, dashboards and reporting (ADR-006). They get no accounts and no access to declarations. The "employer HR focal point" role from ADR-004 is dropped.
8. **Unchanged from ADR-004:** Keycloak with one realm and Organizations, Keycloakify UI, BFF token handling, MFA and step-up at submission, CASL + RLS authorisation, separation of duties, audit of auth events. Public applicants and law enforcement accounts are also unchanged.

## Open points

To be confirmed with the product team. The flowchart lists the same points.

| # | Question | Current proposal |
|---|---|---|
| 1 | Match on personnel file number alone? | Also require national ID: file numbers are often sequential and guessable. |
| 2 | OTPs to roster contacts or to contacts the declarant enters? | Roster contacts where present, masked on screen. That proves the declarant is the person on the roster. |
| 3 | Keep the IPRS identity check? | Yes, run against the roster record's national ID and names when the profile is completed. |
| 4 | Commissions with no roster yet | Their declarants cannot onboard. EACC tracks roster coverage per Commission. |

## Alternatives considered

| Option | Why not |
|---|---|
| Verified self-registration with unverified employment claims (ADR-004) | Claims to the wrong Commission, a verification queue per Commission, and non-filers invisible without a roster. |
| Mass invitations after roster import | Product decision: avoid ~1.5M unsolicited messages, phishing lookalikes and stale-contact bounces. |
| Reporting entities as onboarding or verification actors | Adds thousands of small organisations as users with no legal role in receiving declarations (s.31-32). |

## Consequences

**Positive**
- Every account maps to a record the Responsible Commission vouches for. No wrong-Commission filings.
- Form M non-filer figures are complete from the first cycle: an anti-join of the roster against submissions.
- Fewer actors: no employer HR focal points and no verification queue.

**Negative / risks**
- **Onboarding depends on roster quality and timeliness.** Declarants missing from a roster cannot file until the reporting officer fixes it, which risks the s.34 deadlines. Mitigations: import reports, coverage dashboards for EACC and Commissions, and reminders to Commissions ahead of the cycle.
- **Reporting officers are a bottleneck** for no-match cases at large Commissions (TSC ~436k). Mitigation: a searchable roster admin screen, bulk corrections through re-import, and delegation to more officers per Commission.
- **Account takeover if only the file number is checked.** Mitigated by open points 1 and 2, OTPs and rate limits.
