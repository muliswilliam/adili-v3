# How we work: specs, tickets and agents (build 23 Sep - 9 Oct 2026)

The whole DIALs flow is specced and ticketed in GitHub. This is how the work is laid out and how we run it.

## Dates

- Build: now to **Thu 2 Oct**
- Refine: **7-8 Oct**
- Final pitch: **Fri 9 Oct** (10 min pitch, 5 min live demo, 5 min Q&A). We must supply demo accounts for every role, a hosted prototype and deploy instructions.

## Where everything lives

- Repo: `muliswilliam/adili-v3`. Start at `docs/README.md`, then `AGENTS.md`, `CONTEXT.md` (glossary: use these words in code and UI), `docs/adr/` (decisions; do not fight them), `docs/agents/issue-tracker.md` (conventions).
- Board: https://github.com/users/muliswilliam/projects/1 (fields: Status, Area). Filter `assignee:@me` + Status "Ready".
- Contracts: `packages/schemas/internal/<service>.yaml` (OpenAPI 3.1) and `packages/schemas/forms/*.json` (declaration, Form M, Form K). These are the interface between FE and BE. Change them only via PR. Once a service exports its contract (directory, documents, declarations and notifications so far), its `internal/<service>.yaml` is generated: implemented operations come from the code, not-yet-implemented ones from `packages/schemas/drafts/<service>.yaml`. Edit those, run `pnpm --filter @adili/<service> contracts`, then `pnpm contracts:lint` (Redocly). `pnpm contracts:drift` (and CI) fails when the committed file differs from the export, or when a client generated from a contract (`*.gen.ts`) is stale.
- Flowcharts: `docs/requirements/dials-flowcharts.html`. Every node maps to a spec.

## Specs (one GitHub epic each, spec in the body, FE detail and BE detail as the first two comments)

| Spec | Epic | Milestone |
|---|---|---|
| 01 Commission provisioning | #6 | 01 |
| 02 Roster import | #27 | 02 |
| 03 Declarant onboarding | #58 | 03 |
| 04 Login and obligations | #81 | 04 |
| 05 Declaration capture | #108 | 05 |
| 05b Registry pre-fill and document extraction | #295 | 05b |
| 06 Review, step-up and submit | #131 | 06 |
| 07a Review queue and clarifications | #152 | 07 |
| 07b Registry cross-checks | #176 | 07b |
| 07c AI reviewer copilot | #272 | 07c |
| 08 Compliance determination and actions | #191 | 08 |
| 09 Form M and EACC intake | #214 | 09 |
| 09b National report narrative and open data | #297 | 09b |
| 10 Access requests (Form K, law enforcement, register) | #239 | 10 |
| 11 AI filing helper (Ask Adili) | #296 | 11 |
| 00 Platform, DevOps and mocks | (tickets #363-#372) | 00 |

Each epic has **slices** (sub-issues named "Slice: ...", tracer bullets that are demoable on their own) and each slice has **FE and BE children**. Blocking is native GitHub "blocked by", including cross-spec edges. Every ticket has: Parent, What to build, Acceptance criteria, Blocked by. Scenario IDs (S1, S2...) point to the spec's testing table; those scenarios are the tests you write.

Labels you will see: `area:frontend` / `area:backend` / `area:contract`, `app:portal` / `app:console`, `svc:<service>`, `flow:<flow>`, `design-pending` (FE ticket specifies behaviour, states and copy; visual design is not done yet), `ready-for-agent`.

## Who owns what

| Person | Role | Owns |
|---|---|---|
| @muliswilliam | fullstack, BE lead | Specs 01, 04, 06, 07b, 07c, 10 end to end (FE + BE), plus platform packages (api-kit, bff-auth, Temporal, cipher, numbering), documents, notifications, integration-gateway adapters, ai-gateway, the BE of 11 and 09b, and all contract-convergence tickets. Reviews all BE. |
| @SGNjogu | fullstack BE | BE of 02, 03, 05, 05b, 07a, 08, 09 (directory, declarations, review, reporting). Reviews @muliswilliam's BE. |
| @luckson1 | FE | Portal (declarant and applicant): FE of 03, 05, 05b, 11, 09b public page; portal UI primitives rounds; pixel and a11y pass on every merged spec's portal screens. |
| @iann-mathaiya | Design + FE | Design system and `design-pending` resolution ahead of each spec; console FE of 02, 07a, 08, 09, 09b; UI primitives rounds; pixel pass on console. |
| @Arlus | DevOps | Milestone 00: dev stack (#363), CI (#364), Keycloak realm as code (#365), mocks (#366 IPRS+SMS, #367 registries, #368 HR/payroll/ICMS, #178 HR suppliers), observability (#369), hosted demo (#370), seeding (#371), security baseline (#372). |
| @denisngahu | Product | Owns all epics: acceptance of each spec PR against its scenario table on the preview, demo script, copy, judges' pack. |

Tickets are already assigned to match this. If something on your list looks wrong, say so in the ticket.

Slice parents that are unassigned belong to whoever runs the spec; they close automatically when their children close. Nobody works a slice parent directly.

## How we work: agent-driven, spec-sized

We use Claude Code with the Matt Pocock skills plugin (install it in Claude Code from the `mattpocock` marketplace; run `/setup-matt-pocock-skills` once so it picks up our tracker conventions).

**1. Whole-spec runs (fullstack runners: @muliswilliam, @SGNjogu)**

```
/implement-spec #<epic>
```

One branch, one PR per spec. The skill reads the epic + tickets as a task graph, spins implementer subagents per ticket in their own worktrees, merges them, runs `/code-review`, then marks the PR ready. Run it in a dedicated worktree, one or two specs at a time, and let it work. Name the branch `spec-NN/<slug>`. If the predecessor spec is not merged yet, branch from its branch (02 stacks on 01, 05 on 04).

**2. Area-scoped runs (FE devs, or when splitting a spec)**

```
/implement-spec #<epic> frontend tickets only (area:frontend). Build against the generated client from packages/schemas/internal/<service>.yaml with MSW handlers as the fake backend.
```

Same for `backend tickets only (area:backend, area:contract)`. FE and BE branches touch disjoint trees (`apps/` + `packages/ui` vs `services/` + `packages/*`), so they merge independently. FE PRs ship with MSW so they are demoable alone.

**3. Single-ticket runs**

```
/implement #<ticket>
```

For UI primitives rounds, mocks, one-off tickets, or fixes after review. Use `/tdd` at the seams the spec names; `/code-review` before you push.

**4. Definition of done for any run**

- Tests first, from the spec's scenario table. BE tests drive the service through its HTTP API against real Postgres with fakes for other services. FE tests render every state listed in the FE comment.
- `pnpm format:check`, lint, typecheck and tests green locally before pushing; CI must be green before review.
- PR body: what it delivers, which scenarios are covered, `Closes #child1 #child2 ...` for every ticket it completes. No co-author lines. Stage with explicit `git add <paths>`, never `git add -A`.
- Plain dash, never the em dash, in code and docs. Do not edit CHANGELOG or generated files.
- Every AI output in product is labelled AI-assisted and a named human decides. Indicators, never findings.
- No personal data or financial content in logs, events or AI prompts outside the classification gate.

**5. Reviews**

The reviewer for each spec is fixed: BE by the other fullstack, app changes by the app's FE owner, acceptance by @denisngahu on the preview. Review once when the PR flips to ready; request fixes as comments and let the runner apply them with another agent run. Merge in spec order (01 → 02 → 03 → 04 → 05 → 06 → 07a → 07c/07b → 08 → 09 → 10 → 11 → 05b → 09b) so nothing lands on missing foundations.

## Local setup

```
pnpm bootstrap
pnpm infra:up
pnpm dev
```

Notes: `docker` may be Podman on your machine (fine). Host ports are offset: Postgres 55432, Valkey 56379, RabbitMQ 55672, apps 3010 (portal) 3020 (console) 3030 (verify), services 4001-4011, mocks 8000. TypeScript is pinned to 6.0. If `compose up --wait` complains about finished init jobs, `scripts/infra-up.sh` already handles it.

## Order of play this week

1. @Arlus: #364 CI and #363 dev stack today, then #366 IPRS + SMS mocks (unblocks onboarding), then #368, #367.
2. @muliswilliam: platform tickets (#9 #29 #30 #60 #61 #63 #110 #134 #135) as one `/implement` run, then `/implement-spec #6` (01), then 04, 06, 07c.
3. @SGNjogu: `/implement-spec #27` (02) stacked on 01, then 03, 05, 07a, 08, 09.
4. @iann-mathaiya and @luckson1: design system and the first primitives rounds (#8, #64, #114, #159) ahead of the runs; then FE-only runs and pixel passes as specs merge.
5. @denisngahu: demo script against the flowcharts, demo account list with @Arlus (#371), acceptance as PRs flip to ready.

Daily 15-minute sync; blockers go in the ticket, not in chat. Demo-critical by 2 Oct: 01-06, 07a, 08, 09 core, 10 Form K slice, 07c copilot panel, 11 Ask Adili. Everything else is pitch material if time allows.
