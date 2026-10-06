# Demo accounts

Judges' pack: every demo account, for the hosted demo and a local stack. The story that uses them is in the [demo guide](demo/README.md).

## How to sign in

- **One click (demo mode).** Portal and console show a `DEMO` pill in the header. Its **Act as** menu signs in as any account below with no password or code (#616). Every switch is in the audit trail.
- **One sign-in per browser.** Portal and console share the browser's Keycloak sign-in: acting as someone in one app signs the other app out (or leaves it showing that account). To show both side by side, use two browser profiles, or the console in a private window.
- **Resets sign everyone out.** After a checkpoint reset (the **Azure demo command** workflow or the console's demo panel), open the app's start page, not a deep link, and pick **Act as** again.
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
| Wanjiku Kamau | `wanjiku` | KEMSA, ID 27451863 | Previous declaration filed; current a draft holding what carries over (details, household, other information, her salary without an amount, her loan) | Live filing: Check registries, Read into the form, Ask Adili, submit; then the three registry flags |
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

## Real end-to-end test accounts

The accounts above sign in with one click and no second factor. For testing the hosted demo as a real user would, there is one more account per role with a real mailbox and real MFA, and no `demo_key`, so **Act as** cannot sign them in. Their email goes to `<role>@<E2E_EMAIL_DOMAIN>`: on the hosted demo the domain of the repo secret `SMTP_FROM` (`williammuli.dev`), unless the repo variable `E2E_EMAIL_DOMAIN` names another. Mail there is read in the Resend dashboard (Receiving).

```sh
gh workflow run "Azure demo command" -R muliswilliam/adili-v3 -f command=e2e-accounts
gh workflow run "Azure demo command" -R muliswilliam/adili-v3 -f command=e2e-accounts -f argument=resend
E2E_EMAIL_DOMAIN=example.test pnpm e2e:accounts     # a local stack (mail stays in Mailpit)
```

The command is idempotent: it creates what is missing, puts back a drifted account (role, tenant, a stray `demo_key`), emails nothing on a second run, and prints the table below with each account's state. `resend` emails the setup link again to the accounts that have not finished setting up. It needs a seeded stack (the PSC reporting officer and the platform admin demo accounts act for it).

| Role | Username | Email | Tenant | How they start | How they sign in |
| --- | --- | --- | --- | --- | --- |
| Reporting officer | `e2e-reporting-officer` | `reporting-officer@williammuli.dev` | psc | Setup email: enrol an authenticator app, set a password (link valid 72 hours) | Console: username or email, password, authenticator code |
| Reviewer | `e2e-reviewer` | `reviewer@williammuli.dev` | psc | Same | Same |
| Supervisor | `e2e-supervisor` | `supervisor@williammuli.dev` | psc | Same | Same |
| Commission admin | `e2e-commission-admin` | `commission-admin@williammuli.dev` | psc | Same | Same |
| Access officer | `e2e-access-officer` | `access-officer@williammuli.dev` | psc | Same | Same |
| EACC analyst | `e2e-eacc-analyst` | `eacc-analyst@williammuli.dev` | eacc | Same | Same |
| EACC supervisor | `e2e-eacc-supervisor` | `eacc-supervisor@williammuli.dev` | eacc | Same | Same |
| Auditor | `e2e-auditor` | `auditor@williammuli.dev` | eacc | Same | Same |
| Helpdesk | `e2e-helpdesk` | `helpdesk@williammuli.dev` | platform | Same | Same |
| Platform admin | `e2e-platform-admin` | `platform-admin@williammuli.dev` | platform | Same | Same |
| Law enforcement | `law-enforcement@williammuli.dev` | the same | lea, agency DCI | Provisioned by the platform admin through the directory, as any officer: its activation email verifies the email, enrols an authenticator, sets a password | Console: email, password, authenticator code |
| Declarant | their officer reference, given at onboarding | `declarant@williammuli.dev` | psc | Portal, **Get started**: Commission PSC, personnel file `PSC/2016/00000`, national ID `69000000` (Kibet Ruth Okoth). The email code comes to the mailbox; the phone code (`+254790000000`) is in the console's **Demo panel**, **Demo inbox**; then the set-password email | Portal: officer reference or email, password, a code by SMS (Demo inbox), or **send it by email** for the mailbox |
| Applicant | `applicant@williammuli.dev` | the same | none | Portal, **Request access**, register with national ID `69000001`, names Hassan Paul Okoth (first, other, surname), any phone (its code is in the Demo inbox) and the e2e email; then the set-password email | Portal: email, password, a code by SMS (Demo inbox), or **send it by email** |

The declarant's and the applicant's records in the simulated registries (IPRS, KRA, HR) come from the mocks' synthetic generator in a national ID block of their own (69,000,000 on), so the identities above are the same on every stack.

How the mail gets out: everything the stack sends still goes to Mailpit, as locally. On the hosted demo Mailpit also relays a copy of each message addressed to the e2e domain, and only those, through Resend (`infra/azure/demo-vault.sh`), from `SMTP_FROM`. Mail to every other address, such as the synthetic officers' `*.go.ke` ones, never leaves Mailpit.

Resets: a checkpoint restore (`reset`, the console's demo panel) keeps the staff, law-enforcement and applicant accounts as they are, passwords and authenticators included (`scripts/lib/e2e-keep.sh`). The declarant's account goes with their onboarding, roster record and obligations, which the restore puts back to the checkpoint: after a reset to a checkpoint from before they onboarded, they onboard again. The workflow's `reset` runs `e2e-accounts` afterwards, which puts their roster record back; after a reset from the demo panel, run `e2e-accounts` before onboarding again. A `wipe` deletes every account: run `e2e-accounts` again, and each account sets up from a new email.
