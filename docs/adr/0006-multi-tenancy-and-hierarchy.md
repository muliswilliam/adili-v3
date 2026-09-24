# ADR-006: Multi-tenancy and hierarchy

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-001](0001-postgresql-as-sole-structured-data-store.md), [ADR-004](0004-identity-keycloak-self-registration.md), [ADR-009](0009-api-first-interoperability.md), [research/dials-scope-and-scale.md](../research/dials-scope-and-scale.md)

## Context

- Declarations go to the officer's **responsible Commission** (s.31-32, Reg 5): ~160 bodies.
- The PSC can delegate DIALs functions for officers below job group M (s.33), and EACC can delegate functions (s.7(c), Reg 4).
- Officers work for **reporting entities** (employers), which may differ from the reviewing Commission: a teacher works at a school but files with TSC.
- Officers move between employers and Commissions. Material-change detection needs the previous declaration (s.31(3)-(4)).
- EACC oversees. It receives compliance reports (Reg 25) and referrals (Reg 20), but is **not** the receiver of other officers' declarations. Other access needs a lawful request (s.36(2), Reg 23), and confidentiality breaches are offences (s.36(4), s.46).
- Admin Mechanism 39: Commissions may use the EACC platform, or run their own system and exchange data.

## Decision

1. **Tenant = responsible Commission.** Tenant types:
   - **hosted:** uses the Adili portals
   - **federated:** runs its own system and exchanges data through the public API (ADR-009)
2. **Hierarchy inside a tenant** is an `org_units` tree stored as a Postgres `ltree` path (e.g. `psc.moh.kemsa.hq`):
   - delegated body → reporting entity → department → work station
   - Reporting entities also appear in a **national directory**, so an employer can relate to several tenants: a school's teachers go to TSC and its board staff to PSC.
3. **Delegations are data:** delegating body, delegate, scope (categories, e.g. job group below M), Gazette reference, validity dates. Access policies read active delegations.
4. **Person is global** (national ID), linked to:
   - an **employment** (employer org unit, dates, category)
   - a **responsible tenant**, derived from category rules and delegations
   - Each declaration is stamped with the tenant that received it.
5. **Isolation, in four layers:**
   1. **Token:** tenant memberships and roles (Keycloak, ADR-004).
   2. **Service policy (CASL):** tenant + org-path scope (`path <@ :scope`) + data classification.
   3. **Postgres row-level security:** every transaction runs `SET LOCAL app.tenant_id` and `app.scope_paths` through the shared data-access library. Tables use `FORCE ROW LEVEL SECURITY`, and services connect as non-owner roles.
   4. **Tests:** CI asserts that cross-tenant and out-of-scope reads and writes fail.
6. **Shared schema + RLS** for all tenants. Large tenants (TSC ~436k, PSC) can later be sharded by `tenant_id` with Citus (ADR-001 scale path).
7. **Per-tenant encryption keys:** financial fields are envelope-encrypted with a tenant data key held in OpenBao. That isolates tenants cryptographically as well as logically.
8. **Per-tenant configuration**, versioned:
   - statutory periods, reminders, grace periods
   - escalation ladder (notice → warning → salary stoppage → disciplinary)
   - approval chains
   - letter and notification templates, branding
9. **EACC access model** (not a super-tenant):

| EACC sees | How |
|---|---|
| Form M reports, national aggregates and trends | Default |
| Declarations of EACC staff | EACC is their responsible Commission (Reg 5(a)) |
| A specific officer's declaration | Only through a **referral case** (Reg 20) or a **law enforcement request** (Reg 23): logged, with the declarant notified |

10. **Transfers between tenants: "compare, don't show".**
    - The declarations service (acting as a system actor) compares the new declaration with the person's previous one, wherever it is held.
    - The new tenant sees **only the computed material changes**, not the previous declaration.
    - The full previous declaration needs an explicit, approved, logged request to the holding tenant.
    - The declarant sees their own history and the comparison while filing.

## Alternatives considered

| Option | Why not |
|---|---|
| Schema per tenant | ~160 schemas × migrations; cross-tenant national aggregates get complicated. |
| Database per tenant | Heavy to run at ~160; loses shared national directory and person identity. |
| App-only isolation (no RLS) | A single missing `WHERE tenant_id` leaks data; the database must enforce it. |
| EACC as super-tenant | Contradicts s.31/s.36/s.46; a large blast radius if an account is compromised. |
| Full history transfer on move | Gives a new tenant data it never lawfully received. |
| No cross-tenant history | Breaks material-change detection (s.31(3)-(4)). |

## Consequences

**Positive**
- Mirrors the legal structure: Commissions, delegations, employers, EACC oversight.
- Isolation is enforced by the database and by encryption, not just by convention.
- Supports hosted and federated Commissions (Admin Mechanism 39).

**Negative / risks**
- RLS needs discipline: every query must run through the shared data-access library with tenant context. Enforced by tests and lint rules.
- Category rules that derive the responsible Commission must be maintained as law and Gazette notices change. They're versioned data with an admin UI.
- "Compare, don't show" is pending EACC confirmation. It's a policy switch if EACC allows fuller access.
