# ADR-018: Person-scoped row-level security for a declarant's own records

- **Status:** Accepted; amended 2026-10-01: declarants write their own drafts through the person axis (decision 5, spec #108)
- **Date:** 2026-09-29
- **Deciders:** Adili V3 DIALs team
- **Supersedes:** [ADR-006](0006-multi-tenancy-and-hierarchy.md) decision 5 (isolation) in part: row-level security gains a second axis, the person, next to the tenant: read-only, except for a declarant's own drafts (decision 5). The rest of ADR-006 still stands.
- **Related:** [ADR-004](0004-identity-keycloak-self-registration.md), [ADR-014](0014-roster-gated-declarant-onboarding.md), [ADR-017](0017-obligation-reminder-delivery.md)

## Context

ADR-006 isolates every row by tenant: each transaction sets `app.tenant`, and policies admit that tenant's rows (or every tenant's for `platform` work). That fits staff, who work for one Commission.

A declarant is not a tenant member in that sense. The person is global (ADR-006 decision 4), and one person can have roster records, and so filing obligations, at two Commissions at once (a move between them, or a delegated body). Spec 04's portal shows a declarant all of their obligations in one list, whichever Commission holds them, and never anyone else's. A declarant's token carries no tenant; it carries the person (`person_id`, spec 04 BE-4).

## Decision

1. **A person context for declarant reads.** `withPerson(db, { personId, subject }, work)` in `packages/data-access` runs `work` in a transaction with `app.person` and `app.subject` set transaction-locally, and `app.tenant` unset, so tenant policies admit nothing in it. The person id comes only from the verified token's `person_id` claim (`Principal.personId` in `packages/api-kit`), mapped from a Keycloak user attribute that only administrators (the directory, at onboarding) can set; never from a header or a path.
2. **`*_person_read` policies, `FOR SELECT` only.** A table holding a declarant's rows adds, next to its tenant policy, `CREATE POLICY <table>_person_read ... FOR SELECT USING (person_id = nullif(current_setting('app.person', true), '')::uuid)`. A child table without its own `person_id` admits the rows whose parent the person may read (`EXISTS` on the parent, which is itself under row-level security). Declarants never write through the person axis, except their own drafts (decision 5): every other write stays tenant-scoped system or staff work. A setting reset at the end of an earlier transaction reads back as `''` on a pooled connection, hence `nullif`, so the policy neither fails nor matches then.
3. **Cross-tenant only for the declarant's own rows.** The person axis is the one way to read across Commissions other than `platform` work, and it admits exactly the rows that carry the caller's person id. Staff reads stay tenant-scoped. A route open to both (one obligation) reads with the person context first when the token has a person id and falls back to the caller's staff tenant; whatever neither admits is 404.
4. **Today:** the declarations service's `filing_obligations` (`filing_obligations_person_read`), `obligation_reminders` (`obligation_reminders_person_read`, through its obligation) and `roster_snapshots` (`roster_snapshots_person_read`, migration 0010), read by `GET /v1/me/obligations` and `GET /v1/obligations/{id}`. Later declarant-owned tables (declarations, slips) follow the same pattern for reads; drafts are written through it too (decision 5). *Amended 2026-10-01 (spec #325):* `help_articles` (`help_articles_person_read`, migration 0018) is not declarant-owned but is read through the person axis by a different shape: a declarant reads the published articles of every Commission they have a filing obligation with, through an `EXISTS` on `filing_obligations` that is itself under the person policy, so it sees only the declarant's own obligations. The obligation's status does not matter: a declarant whose obligations with a Commission are closed still reads its guidance. `services/declarations/test/help/help.integration.test.ts` covers that one Commission's articles reach its declarants only. Tests assert that a person sees only their own rows across Commissions, never another person's, and that a token without `person_id` sees nothing (`packages/data-access/test/person-scope.integration.test.ts`, the declarations read tests, `services/declarations/test/obligations/roster-snapshot-person-scope.integration.test.ts`).

5. **Declarants write their own drafts.** *Amended 2026-10-01 (spec #108).* A draft declaration is the declarant's work in progress: only they create, save, attach to or discard it, across Commissions, and no staff or system work touches it until it is submitted. So the draft tables take one person policy for every command, with the same `USING` and a `WITH CHECK` that keeps each new or changed row on the caller's person:
   - `declarations` (`declarations_person`);
   - `declaration_sections` and `declaration_attachments` (`declaration_sections_person` and `declaration_attachments_person`, through their declaration);
   - `obligation_drafts` (`obligation_drafts_person`), the ids that let a Commission count live drafts.

   The tenant policies on these tables stay `FOR SELECT`. `declarations_tenant_read` admits no draft, so staff never read one. A declaration is written through the person axis only while it is a draft; submission (spec 06) and everything after it are tenant-scoped. The tests that another person can neither read, update, delete nor insert into a declarant's draft rows, and that a declarant cannot move a draft to another person, are in `services/declarations/test/drafts/drafts.integration.test.ts`. Its "keeps drafts from every transaction but the declarant's own" test covers reads and "lets no other person write a declarant's draft rows" covers writes.

## Alternatives considered

| Option | Why not |
|---|---|
| Read as `platform` and filter by person id in the query | App-only isolation: one missing `WHERE person_id` leaks every Commission's declarants, which ADR-006 rules out. |
| One `withTenant` read per Commission the person belongs to | The token would have to carry the person's Commissions, which change on a move while tokens live on; and N reads per page. |
| Tenant memberships for declarants, like staff | Makes a declarant a member of each Commission's tenant, which suggests access to that tenant's data; the person axis admits only their own rows. |

## Consequences

**Positive**
- The database, not the query, keeps a declarant to their own rows, across Commissions.
- One pattern (`withPerson` plus a `*_person_read` policy) for every declarant-facing read to come, and one (a person policy for every command) for the drafts a declarant writes.

**Negative / risks**
- Two policies per declarant table to keep right; a table missing its person policy shows the declarant nothing (safe), a wrong one could show too much, so each gets a cross-person test. The draft tables' write policies (decision 5) get a cross-person write test as well.
- The `person_id` claim is as trusted as the tenant claim: the Keycloak attribute must stay admin-only in the realm's user profile.
