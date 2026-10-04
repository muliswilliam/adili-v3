# Demo accounts

Judges' pack for the hosted demo and for local sign-in. Every account uses the password `Adili-Demo-2026`. The accounts are the Keycloak realm import `infra/compose/keycloak/adili-realm.json`. `pnpm db:seed` creates the Commissions they belong to (PSC, TSC, EACC), the government-system mocks, the applicant, and the DCI officer.

Staff and the law-enforcement officer enrol TOTP on first sign-in. The declarant and the applicant receive an SMS one-time code (Mailpit locally, the SMS inbox on the mocks).

| Where | Local | Hosted demo |
| --- | --- | --- |
| Portal | http://localhost:3010 | https://adili-demo.southafricanorth.cloudapp.azure.com |
| Console | http://localhost:3020 | https://adili-demo.southafricanorth.cloudapp.azure.com:3020 |

| Login | Name | Role | Signs in at | Commission | Purpose |
| --- | --- | --- | --- | --- | --- |
| `declarant` | Wanjiku Kamau | Declarant | Portal | PSC | File her declarations. The mocks give her a vehicle, a Kajiado parcel and a company directorship she has not declared. |
| `applicant` | Njoki Wambua | Applicant | Portal | Public | Submit a Form K request to see someone else's declaration. |
| `reporting-officer` | Otieno Odhiambo | Reporting officer | Console | PSC | Import and maintain the PSC roster (`mocks/demo/rosters/psc-roster.csv`). |
| `tsc-reporting-officer` | Jepkosgei Chelimo | Reporting officer | Console | TSC | Import the TSC roster (`mocks/demo/rosters/tsc-roster.csv`). |
| `reviewer` | Achieng Njeri | Reviewer | Console | PSC | Work the PSC review queue. |
| `supervisor` | Kiprono Chebet | Supervisor | Console | PSC | Approve reviews, determinations and Form M for the PSC. |
| `commission-admin` | Mwangi Wairimu | Commission admin | Console | PSC | Administer the PSC. |
| `access-officer` | Amina Hassan | Access officer | Console | PSC | Decide Form K and law-enforcement access requests. |
| `eacc-analyst` | Baraka Mutua | EACC analyst | Console | EACC | Analyse Form M and the national report. |
| `eacc-supervisor` | Nafula Wekesa | EACC supervisor | Console | EACC | Supervise EACC intake and sign-off. |
| `auditor` | Kariuki Muriithi | Auditor | Console | EACC | Read the audit trail. |
| `helpdesk` | Zawadi Akinyi | Helpdesk | Console | Platform | Support accounts. |
| `platform-admin` | Juma Omondi | Platform admin | Console | Platform | Provision Commissions and law-enforcement agencies. |
| `law-enforcement` | Suleiman Ali | Law enforcement | Console | DCI | Request access to a declaration as a DCI officer. |
