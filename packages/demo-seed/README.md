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
| ai-gateway | `AI_PROVIDER=anthropic` | PSC cases get their copilot; documents are read |

`DEMO_SEED_VOLUME` (default 500 synthetic officers per volume Commission; PSC gets a fifth),
`DEMO_SEED_CONCURRENCY` and the service URLs are in `src/config.ts`.

## Steps

| Step | Makes | Through |
| --- | --- | --- |
| `commissions` | psc, tsc, eacc, jsc, npsc and their reporting officers (demo accounts) | directory API (platform-admin), Keycloak admin for `demo_key` |
| `policies` | Demo policy: biennial statement date 30 June (due 31 December), obligations from 30 June 2024, reminders 30/14/7/1 days | `pnpm --filter @adili/directory demo:policy` (no API changes these) |
| `cycles` | Demo cycles 2024 (previous, closed) and 2026 (current, open) | `pnpm --filter @adili/declarations demo:cycles` (no API for the calendar) |
| `synthetic-people` | Synthetic officers in IPRS, KRA, HR, NTSA, ArdhiSasa, BRS | the mocks' `POST /demo/synthetic-officers` (deterministic) |
| `rosters` | Every Commission's roster: personas, roster-only officers, timed officers, volume | roster file import as the reporting officer |
| `onboarding` | Every officer but the roster-only ones onboarded, each a demo account | public onboarding API, codes from Mailpit and the SMS inbox |
| `filings` | Personas' declarations, the volume's (on time, late, missing, registry mismatches) | the portal's draft and submit API, as each declarant |

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
| (roster only) | Achieng Njeri, PSC (28836510) | Not onboarded: live onboarding with SMS OTP |
| (roster only) | Daniel Rotich, PSC (38221907) | IPRS name mismatch: the identity check fails |

## Rehearsing the live filing

`pnpm --filter @adili/demo-seed rehearse` runs Wanjiku's live beat through the APIs: Check
registries, read the sample files (`mocks/demo/files`) into the form with the real AI provider,
submit, then checks the reviewer's case has the three 07b flags and the comparison. It files her
declaration, so reset to `0-start` afterwards.
