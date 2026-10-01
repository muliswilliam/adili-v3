import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { reviewCases } from '../cases/schema.js';
import { REGISTRY_CHECK_STATUSES, REGISTRY_SYSTEMS } from '../rules/index.js';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * The registry check of a case (spec 07b): per person of the declaration and registry, the status
 * of the latest check, why a registry was unavailable, and the gateway's result id to pull the
 * records from when the Registry tab opens. No registry records are stored here: the gateway
 * holds them, encrypted, with their legal basis. Tenant data under row-level security (migration
 * 0014), like the case.
 */
export const registryChecks = pgTable(
  'registry_checks',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    /** The version whose declared items were checked. */
    versionId: uuid().notNull(),
    /** The statement's person: `officer`, `spouse:<id>` or `child:<id>`. */
    personKey: text().notNull(),
    system: text({ enum: REGISTRY_SYSTEMS }).notNull(),
    status: text({ enum: REGISTRY_CHECK_STATUSES }).notNull(),
    /** Why the system was unavailable (the gateway's reason); null otherwise. */
    reason: text(),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resultId: uuid(),
  },
  (table) => [
    uniqueIndex('registry_checks_case_person_system_key').on(
      table.caseId,
      table.personKey,
      table.system,
    ),
    // The sweep (#187): cases with a system still unavailable.
    index('registry_checks_tenant_status_idx').on(table.tenant, table.status),
    check('registry_checks_system_check', sql`${table.system} in (${inList(REGISTRY_SYSTEMS)})`),
    check(
      'registry_checks_status_check',
      sql`${table.status} in (${inList(REGISTRY_CHECK_STATUSES)})`,
    ),
  ],
);

export const registrySchema = { registryChecks };
