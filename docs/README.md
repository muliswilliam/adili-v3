# Documentation

Adili Online V3, Track 3: **Declaration of Income, Assets and Liabilities (DIALs)**.

## Start here

| If you want to… | Read |
|---|---|
| Understand the system end to end | [Architecture](architecture/README.md) |
| Know why we chose X | [Architecture Decision Records](adr/) |
| Browse the APIs every service exposes | [API reference](https://muliswilliam.github.io/adili-v3/api-docs/) (Redoc, built by `pnpm api:docs` from [packages/schemas](../packages/schemas/)) |
| See how the law maps to features | [Legal traceability matrix](requirements/legal-traceability.md) |
| See how EACC's user stories are covered | [User story coverage](requirements/user-stories.md) |
| See the product team's process flowcharts (onboarding, DIALs, access) | [Flowcharts](requirements/dials-flowcharts.html) |
| Know who owns what and how we run specs with agents | [How we work](how-we-work.md) |
| Sign in for the demo or the judges' pack | [Demo accounts](demo-accounts.md) |
| Pick up a ticket: read its spec (the epic issue) and the API contract | [Epics](https://github.com/muliswilliam/adili-v3/issues?q=label%3Aepic) · [Internal contracts](../packages/schemas/internal/) · [Contract convergence notes](contracts/) |
| Understand scale and sizing | [Scope and scale](research/dials-scope-and-scale.md) · [Database sizing](research/database-sizing.md) |
| Learn the domain vocabulary | [CONTEXT.md](../CONTEXT.md) |
| Look up a code or issuer (`DCB`, `TSC`) | [Glossary](glossary.md) |
| Build UI: tokens, components and how the prototypes map to code | [Design](design.md) |
| Run the hackathon demo: quick start, the story beat by beat, checkpoints, fallbacks, demo-day checklist | [Demo](demo/README.md) |
| Work with agent skills (issue tracker, triage labels, domain docs) | [Agent config](agents/) |
| Read the legislation | [Legal reference](reference/legal/) |

## Layout

```text
docs/
├── architecture/     # system architecture and diagrams
├── adr/              # architecture decision records (0001-0017)
├── agents/           # config read by engineering agent skills
├── contracts/        # per-spec notes: drafted contracts vs what was built
├── demo/             # running the hackathon demo
├── requirements/     # legal traceability, user story coverage, flowcharts
├── research/         # scope, population, sizing
├── reference/legal/  # Conflict of Interest Act 2025, Regulations 2026
├── design.md         # prototype kit mapped to packages/ui tokens and components
└── glossary.md       # reference-number codes, issuer codes, key terms
```

## Conventions

- ADRs are numbered, immutable once accepted, and superseded by new ADRs rather than edited in substance.
- Legal references use **Act s.N** (Conflict of Interest Act 2025), **Regs r.N** (Regulations 2026) and **AM** (Administrative Mechanisms, Aug 2026).
- Diagrams are Mermaid, rendered by GitHub and checked with the Mermaid CLI before merging.
