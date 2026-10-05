# @adili/demo-seed

`pnpm demo:seed` brings a running stack to the demo's starting state (#371, checkpoint
`0-start`) through the services' own APIs, so every review case, obligation, slip and workflow is
real. It is idempotent: a second run changes nothing (`unchanged` per step, and the
`fingerprint` row counts match).

```sh
pnpm demo:seed                      # every step
pnpm demo:seed --only rosters       # some steps
pnpm demo:seed --from onboarding    # resume
pnpm --filter @adili/demo-seed seed --list
```

## What it needs

- The stack up: `pnpm infra:up` with `ADILI_DEMO_MODE=true` (Keycloak's demo sign-in, #616), and
  the services and mocks running (`pnpm dev`).
- Demo sign-in applied to an existing realm: `pnpm keycloak:demo-sign-in`.
- The demo's service settings (the hosted stack sets them in `infra/azure/configure-app-env.sh`):

| Service `.env` | Setting | Why |
| --- | --- | --- |
| directory | `RATE_LIMITS` with `onboarding-identify`, `onboarding-identify-commission`, `onboarding-session` at e.g. `100000/60s`; `ONBOARDING_ABUSE_THRESHOLD=1000000` | The seed onboards every officer from one IP |
| mocks | `MOCK_REGISTRY_RATE_LIMIT=100000` | Registry checks of every filing |
| integration-gateway | `KRA_`, `NTSA_`, `BRS_`, `ARDHISASA_`, `HR_SUPPLIERS_RATE_LIMIT_PER_MINUTE=100000` | Same |
| declarations | `REMINDER_JITTER_HOURS=0` | The reminder officer's reminder goes out at noon |
| review | `DEMO_MODE=true` | The review steps switch review's demo windows (`PUT /v1/demo/windows`) to seed states past a reply window, a ladder window or a case's clarification window in minutes, and back to legal |
| ai-gateway | `AI_PROVIDER=anthropic` | PSC cases get their copilot; documents are read |
| access | `DEMO_MODE=true`, `DEMO_PACKAGE_VALIDITY=PT2M`, `DEMO_WINDOW_TENANTS=jsc` | JSC's access package expires (verify shows `expired`); PSC's packages keep their download window |
| audit | running from the start | Events published while it is down are not kept (no queue holds them), so the auditor's trail covers what ran while it was up |

`DEMO_SEED_VOLUME` (default 500 synthetic officers per volume Commission; PSC gets a fifth),
`DEMO_SEED_CONCURRENCY` and the service URLs are in `src/config.ts`.

## Steps

| Step | Makes | Through |
| --- | --- | --- |
| `commissions` | psc, tsc, eacc, jsc, npsc and their reporting officers (demo accounts) | directory API (platform-admin), Keycloak admin for `demo_key` |
| `mock-fixtures` | The mocks' named people (IPRS, KRA, HR) from `mocks/demo/fixtures`, refreshed | the mocks' own idempotent `db:seed` |
| `policies` | Demo policy: biennial statement date 30 June (due 31 December), obligations from 30 June 2024 (EACC from 2022), reminders 30/14/7/1 days | `pnpm --filter @adili/directory demo:policy` (no API changes these) |
| `cycles` | Demo cycles 2022 (EACC only), 2024 (previous, closed) and 2026 (current, open) | `pnpm --filter @adili/declarations demo:cycles` (no API for the calendar) |
| `synthetic-people` | Synthetic officers in IPRS, KRA, HR, NTSA, ArdhiSasa, BRS | the mocks' `POST /demo/synthetic-officers` (deterministic) |
| `rosters` | Every Commission's roster: personas, roster-only officers, timed officers, volume | roster file import as the reporting officer |
| `onboarding` | Every officer but the roster-only ones onboarded, each a demo account | public onboarding API, codes from Mailpit and the SMS inbox |
| `filings` | Personas' declarations, the volume's (on time, late, missing, registry mismatches) | the portal's draft and submit API, as each declarant |
| `settle` | Waits for every declaration's review case and the personas' slips | review and declarations APIs |
| `review-team` | Two more PSC reviewers (Brian Kiptoo, Mercy Wanjala) and EACC's own staff supervisor (Lilian Chepkoech) | Keycloak admin (no API creates Commission staff) |
| `review-queue` | 22 PSC volume cases across the bands claimed by the three reviewers; Amina's amended case with the second; copilot summaries the seeding burst failed asked again | review API (claim, copilot refresh) |
| `review-clarifications` | Kiprono's AI-drafted clarification, edited and issued, awaiting his reply (legal window); one answered, resolved and determined compliant (approved); Otieno's case proposed compliant, awaiting the supervisor; one unanswered past its window with the ladder at a notice and a warning; one carried to a salary stoppage the payroll mock acknowledged | review API as reviewer, declarant and supervisor; short windows through review's demo windows |
| `review-closure` | Clean low-risk PSC cases (officers who had not filed 2026 file now, with a short case window) proposed by the closure sweep and approved in bulk | declarations and review APIs, the closure sweep's Temporal schedule triggered |
| `review-referral` | EACC's officer who missed 2022 and 2024: referral proposed by the sweep, approved by EACC's staff supervisor, pushed to ICMS with its case number | review and reporting APIs, the referral sweep's schedule triggered |
| `access` | Form K about Kiprono awaiting his representations, about Otieno granted (watermarked, signed package), about Amina denied (Regulation 24, proceedings); DCI's request about Kiprono granted; Amina's certified copy of version 2; a JSC grant whose package expires | access API as `applicant`, `access-officer`, `law-enforcement`, the declarants and a seeded `jsc-access-officer` |
| `verify` | A document in every verify status, and a tampered copy of a slip; writes `.demo/verify.md` and `.demo/verify.json` | declarations, review (a JSC clarification issued in error and withdrawn), access and documents APIs |

Why demo cycles: the first real cycle (2027) has its statement date on 1 November 2027, so
nothing can be filed or compared before then. The demo runs two earlier cycles on the same
rules, as data (policy and calendar), not clock changes; both fall in financial year 2025/26, the
year Form M can be compiled now.

### Adding steps (#618, #619, #620)

A step is a `SeedStep` (`src/step.ts`): it reads the state through the APIs and acts only on
what is missing, and returns how much it changed. Add the module to `STEPS` in
`src/steps/index.ts` after the steps it builds on. `context.as(demoKey)` gives the typed APIs as
any demo account (`context.as(key, { fresh: true })` for a fresh step-up before a submit or a
confirm); `syntheticOfficers(context)`, `PERSONAS` and `onboardees(context)` give the people.

## Personas

| `demo_key` | Who | State at `0-start` |
| --- | --- | --- |
| `wanjiku` | Wanjiku Kamau, KEMSA (27451863) | Previous declaration filed; current not started (filed live) |
| `otieno` | Otieno Odhiambo, MOH | Both filed, clean |
| `kiprono` | Kiprono Chebet, PSC | Both filed; KRA non-compliant flag |
| `amina` | Amina Hassan, PSC | Current amended to version 2 |
| `reminder-officer` | Faith Mwende, PSC | Initial due tomorrow: reminder sent today (Mailpit, SMS inbox) |
| `overdue-officer` | Collins Were, PSC | Initial overdue, not filed |
| `referral-officer` | Samuel Langat, EACC (25813407) | Filed neither 2022 nor 2024: referred after two missed cycles, ICMS case number |
| (roster only) | Achieng Njeri, PSC (28836510) | Not onboarded: live onboarding with SMS OTP |
| (roster only) | Daniel Rotich, PSC (38221907) | IPRS name mismatch: the identity check fails |

## Access and verify (#620)

| Who | Sees |
| --- | --- |
| `access-officer` (console, Access requests) | The four PSC requests: Kiprono's awaiting representations, Otieno's granted with the package, Amina's denied, DCI's granted |
| `applicant` (portal) | Her three PSC requests and the JSC one; the packages to download; Amina's denial with its Regulation 24 ground and reasons |
| `law-enforcement` (console) | DCI/ECU/2026/0417 granted, the package to download |
| `kiprono` (portal) | The request to answer (7 days); Who accessed: the request and DCI's grant |
| `otieno`, `amina` (portal) | Who accessed: the grant and package; the denial and the certified copy |
| `auditor` (console, Audit trail) | Every read, change, verify lookup and demo switch since the audit service started |

The `verify` step writes the verification codes and verify pages of a valid slip, a valid access
package, Amina's superseded version 1 slip, a revoked clarification letter and the expired JSC
package to `.demo/verify.md` (and `.json`), with `.demo/tampered-acknowledgement-slip.pdf`: drop
it on the valid slip's verify page and it reports that the file does not match. The codes change
with every seed from an empty stack and stay with a checkpoint; `pnpm demo:seed --only verify`
writes the file again from the stack as it is.

## Rehearsing the live filing

`pnpm --filter @adili/demo-seed rehearse` runs Wanjiku's live beat through the APIs: Check
registries, read the sample files (`mocks/demo/files`) into the form with the real AI provider,
submit, then checks the reviewer's case has the three 07b flags and the comparison. It files her
declaration, so reset to `0-start` afterwards.
