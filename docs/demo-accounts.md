# Demo accounts

Judges' pack: every demo account, for the hosted demo and a local stack. The story that uses them is in the [demo guide](demo/README.md).

## How to sign in

- **One click (demo mode).** Portal and console show a `DEMO` pill in the header. Its **Act as** menu signs in as any account below with no password or code (#616). Every switch is in the audit trail.
- **By hand.** Every account's password is `Adili-Demo-2026`. Staff then enrol TOTP; declarants and the applicant get an SMS code in the mocks inbox (local: http://localhost:8000/sms/inbox; the hosted demo does not publish it).

The switcher's list is one module, `packages/demo-auth/src/accounts.ts` (`DEMO_ACCOUNTS`); this page follows it. The staff accounts come from the realm import (`infra/compose/keycloak/adili-realm.json`); the declarant personas and the extra staff are made by `pnpm demo:seed` (`packages/demo-seed`).

| Where | Local | Hosted demo |
| --- | --- | --- |
| Portal | http://localhost:3010 | https://adili-demo.southafricanorth.cloudapp.azure.com |
| Console | http://localhost:3020 | https://adili-demo.southafricanorth.cloudapp.azure.com:3020 |
| Verify | http://localhost:3030 | https://adili-demo.southafricanorth.cloudapp.azure.com:3030 |

## Console (staff)

| Act as | Login | Role | Commission | Purpose |
| --- | --- | --- | --- | --- |
| Grace Mutiso | `reporting-officer` | Reporting officer | PSC | Imports the PSC roster; obligations and reminders |
| Jepkosgei Chelimo | `tsc-reporting-officer` | Reporting officer | TSC | A second Commission: tenant isolation |
| Achieng Njeri | `reviewer` | Reviewer | PSC | Review queue, registry flags, copilot, clarifications |
| David Ochieng | `supervisor` | Supervisor | PSC | Approves determinations and actions; compiles Form M |
| Mwangi Wairimu | `commission-admin` | Commission admin | PSC | Confirms and submits Form M |
| Anne Atieno | `jsc-commission-admin` | Commission admin | JSC | A submitted Form M; the Commission's open-data preview |
| Halima Yusuf | `access-officer` | Access officer | PSC | Decides Form K and law enforcement requests |
| Baraka Mutua | `eacc-analyst` | EACC analyst | EACC | Form M intake, referrals to ICMS, national report, open data |
| Nafula Wekesa | `eacc-supervisor` | EACC supervisor | EACC | Approves the national report and open-data releases |
| Kariuki Muriithi | `auditor` | Auditor | EACC | The audit trail across every flow |
| Zawadi Akinyi | `helpdesk` | Helpdesk | Platform | Account support: looks a person up by officer reference |
| Juma Omondi | `platform-admin` | Platform admin | Platform | Commissions, AI policy, registry integrations |
| Suleiman Ali | `law-enforcement` | Law enforcement | DCI | Requests access to a declaration for an investigation |

## Portal (declarants and the public)

The seeded declarants sign in with **Act as**; their Keycloak usernames are the officer references onboarding gives them, so they are not listed.

| Act as | Demo key | Who | State at `0-start` | Purpose |
| --- | --- | --- | --- | --- |
| Wanjiku Kamau | `wanjiku` | KEMSA, ID 27451863 | Previous declaration filed; current not started | Live filing: Check registries, Read into the form, Ask Adili, submit; then the three registry flags |
| Otieno Odhiambo | `otieno` | MOH, ID 30194427 | Both filed, clean | The AI does not cry wolf |
| Kiprono Chebet | `kiprono` | PSC, ID 22607781 | Both filed, KRA non-compliant | A clarification to answer; a Form K about him awaits his representations |
| Amina Hassan | `amina` | PSC, ID 31552094 | Current amended to version 2 | Version compare, superseded slip, certified copy |
| Demo declarant | `declarant` | Realm user | | The realm's own declarant |
| Njoki Wambua | `applicant` | Member of the public | Form K requests made | Form K: granted, denied, awaiting representations |

## Seeded people outside the switcher

| Who | Where | State | Use |
| --- | --- | --- | --- |
| Lydia Kwamboka Nyaboke, `PSC/2012/0311`, ID 28836510 | PSC roster | Not onboarded | Live onboarding with SMS OTP (portal, Get started) |
| Daniel Rotich, `PSC/2016/0533`, ID 38221907 | PSC roster | Roster name differs from IPRS | Onboarding fails the identity check |
| Faith Mwende | PSC | Initial due tomorrow | Reminder sent today (Mailpit, SMS inbox) |
| Collins Were | PSC | Initial overdue | Overdue obligation, enforcement ladder |
| Samuel Langat, ID 25813407 | EACC | Missed 2022 and 2024 | Referral after two cycles, ICMS case number |
| Brian Kiptoo, Mercy Wanjala | PSC reviewers | Hold queue cases | Cases spread across reviewers |
| Lilian Chepkoech | EACC staff supervisor | Approved the referral | Separation of duties |
| Reporting officers, supervisors, commission admins and reviewers of JSC, NPSC and EACC | Console | Seeded | Form M and review volume |
