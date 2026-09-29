# ADR-017: Person-scoped row-level security for a declarant's own records

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Adili V3 DIALs team
- **Amends:** [ADR-006](0006-multi-tenancy-and-hierarchy.md) decision 5 (isolation): row-level security gains a second, read-only axis, the person, next to the tenant. The rest of ADR-006 still stands.
- **Related:** [ADR-004](0004-identity-keycloak-self-registration.md), [ADR-014](0014-roster-gated-declarant-onboarding.md), [ADR-016](0016-obligation-reminder-delivery.md)

## Context

ADR-006 isolates every row by tenant: each transaction sets `app.tenant`, and policies admit that tenant's rows (or every tenant's for `platform` work). That fits staff, who work for one Commission.

A declarant is not a tenant member in that sense. The person is global (ADR-006 decision 4), and one person can have roster records, and so filing obligations, at two Commissions at once (a move between them, or a delegated body). Spec 04's portal shows a declarant all of their obligations in one list, whichever Commission holds them, and never anyone else's. A declarant's token carries no tenant; it carries the person (`person_id`, spec 04 BE-4).

## Decision

1. **A person context for declarant reads.** `withPerson(db, { personId, subject }, work)` in `packages/data-access` runs `work` in a transaction with `app.person` and `app.subject` set transaction-locally, and `app.tenant` unset, so tenant policies admit nothing in it. The person id comes only from the verified token's `person_id` claim (`Principal.personId` in `packages/api-kit`), mapped from a Keycloak user attribute that only administrators (the directory, at onboarding) can set; never from a header or a path.
2. **`*_person_read` policies, `FOR SELECT` only.** A table holding a declarant's rows adds, next to its tenant policy, `CREATE POLICY <table>_person_read ... FOR SELECT USING (person_id = nullif(current_setting('app.person', true), '')::uuid)`. A child table without its own `person_id` admits the rows whose parent the person may read (`EXISTS` on the parent, which is itself under row-level security). Declarants never write through the person axis: writes stay tenant-scoped system or staff work. A setting reset at the end of an earlier transaction reads back as `''` on a pooled connection, hence `nullif`, so the policy neither fails nor matches then.
3. **Cross-tenant only for the declarant's own rows.** The person axis is the one way to read across Commissions other than `platform` work, and it admits exactly the rows that carry the caller's person id. Staff reads stay tenant-scoped. A route open to both (one obligation) reads with the person context first when the token has a person id and falls back to the caller's staff tenant; whatever neither admits is 404.
4. **Today:** the declarations service's `filing_obligations` (`filing_obligations_person_read`) and `obligation_reminders` (`obligation_reminders_person_read`, through its obligation), read by `GET /v1/me/obligations` and `GET /v1/obligations/{id}`. Later declarant-owned tables (declarations, slips) follow the same pattern. Tests assert that a person sees only their own rows across Commissions, never another person's, and that a token without `person_id` sees nothing (`packages/data-access/test/person-scope.integration.test.ts`, the declarations read tests).

## Alternatives considered

| Option | Why not |
|---|---|
| Read as `platform` and filter by person id in the query | App-only isolation: one missing `WHERE person_id` leaks every Commission's declarants, which ADR-006 rules out. |
| One `withTenant` read per Commission the person belongs to | The token would have to carry the person's Commissions, which change on a move while tokens live on; and N reads per page. |
| Tenant memberships for declarants, like staff | Makes a declarant a member of each Commission's tenant, which suggests access to that tenant's data; the person axis admits only their own rows. |

## Consequences

**Positive**
- The database, not the query, keeps a declarant to their own rows, across Commissions.
- One pattern (`withPerson` plus a `*_person_read` policy) for every declarant-facing read to come.

**Negative / risks**
- Two policies per declarant table to keep right; a table missing its person policy shows the declarant nothing (safe), a wrong one could show too much, so each gets a cross-person test.
- The `person_id` claim is as trusted as the tenant claim: the Keycloak attribute must stay admin-only in the realm's user profile.
