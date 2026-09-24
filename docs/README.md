# Documentation

Adili Online V3, Track 3: **Declaration of Income, Assets and Liabilities (DIALs)**.

## Start here

| If you want to… | Read |
|---|---|
| Understand the system end to end | [Architecture](architecture/README.md) |
| Know why we chose X | [Architecture Decision Records](adr/) |
| See how the law maps to features | [Legal traceability matrix](requirements/legal-traceability.md) |
| See how EACC's user stories are covered | [User story coverage](requirements/user-stories.md) |
| Understand scale and sizing | [Scope and scale](research/dials-scope-and-scale.md) · [Database sizing](research/database-sizing.md) |
| Look up a code or term (`DCB`, `TSC`, "material change") | [Glossary](glossary.md) |
| Read the legislation | [Legal reference](reference/legal/) |

## Layout

```text
docs/
├── architecture/     # system architecture and diagrams
├── adr/              # architecture decision records (0001-0013)
├── requirements/     # legal traceability, user story coverage
├── research/         # scope, population, sizing
├── reference/legal/  # Conflict of Interest Act 2025, Regulations 2026
└── glossary.md       # reference-number codes, issuer codes, key terms
```

## Conventions

- ADRs are numbered, immutable once accepted, and superseded by new ADRs rather than edited in substance.
- Legal references use **Act s.N** (Conflict of Interest Act 2025), **Regs r.N** (Regulations 2026) and **AM** (Administrative Mechanisms, Aug 2026).
- Diagrams are Mermaid, rendered by GitHub and checked with the Mermaid CLI before merging.
