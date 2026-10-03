import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { OfficerCategoryCode } from './create-commission.js';
import type { StoredTenantPolicy } from './policy.js';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Responsible Commissions. The table that defines tenants, so it is platform-level data and not
 * tenant-scoped under RLS; the service applies the visibility rule (spec 01).
 */
export const commissions = pgTable(
  'commissions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    /** Tenant key: token `tenant` claim, RLS context, events `tenant`, issuer code upper-cased. */
    slug: text().notNull().unique(),
    name: text().notNull(),
    type: text({ enum: ['hosted', 'federated'] }).notNull(),
    status: text({ enum: ['active'] })
      .notNull()
      .default('active'),
    /** `sub` of the caller who created it (`system` for seeds). */
    createdBy: text().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('commissions_name_lower_key').on(sql`lower(${table.name})`),
    check('commissions_slug_pattern', sql`${table.slug} ~ '^[a-z][a-z0-9]{1,19}$'`),
    check('commissions_type_check', sql`${table.type} in ('hosted', 'federated')`),
    check('commissions_status_check', sql`${table.status} in ('active')`),
  ],
);

/** Statutory categories of public officers, one per paragraph of Act s.32 and Regs r.5. Seeded. */
export const officerCategories = pgTable('officer_categories', {
  code: text().$type<OfficerCategoryCode>().primaryKey(),
  citation: text().notNull(),
  description: text().notNull(),
  sortOrder: integer().notNull().unique('officer_categories_sort_order_unique'),
});

export const commissionCategories = pgTable(
  'commission_categories',
  {
    commissionId: uuid()
      .notNull()
      .references(() => commissions.id, { onDelete: 'cascade' }),
    categoryCode: text()
      .notNull()
      .references(() => officerCategories.code),
  },
  (table) => [primaryKey({ columns: [table.commissionId, table.categoryCode] })],
);

/**
 * Versioned tenant policy; version 1 is provisioned from platform defaults with the Commission.
 * Versions are never changed: a change is a new version copying the rest (spec 04), and the one
 * with the highest number is in force.
 */
export const tenantPolicyVersions = pgTable(
  'tenant_policy_versions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenant: text()
      .notNull()
      .references(() => commissions.slug),
    version: integer().notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull().defaultNow(),
    policy: jsonb().$type<StoredTenantPolicy>().notNull(),
    /**
     * Obligations are created only for statement dates on or after it, so officers appointed
     * before the Commission joined Adili owe no initial declaration here (spec 04). Version 1's
     * is the date the Commission was created, in Africa/Nairobi.
     */
    obligationsStartDate: date({ mode: 'string' }).notNull(),
    /** `sub` of the caller who created the version (`system` for seeds). */
    createdBy: text().notNull(),
    /** Their display name at the time (token `name`); null when the token had none. */
    createdByName: text(),
    ...timestamps,
  },
  (table) => [unique().on(table.tenant, table.version)],
);

/**
 * Reporting officer assignments, tenant-scoped under RLS (FORCE ROW LEVEL SECURITY, policy in
 * migration 0003). At most one assignment per Commission is not `replaced` (the current one);
 * the timestamps and `replaced_by` agree with the state.
 */
export const reportingOfficerAssignments = pgTable(
  'reporting_officer_assignments',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    commissionId: uuid()
      .notNull()
      .references(() => commissions.id),
    tenant: text().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    /** E.164. */
    phone: text().notNull(),
    keycloakUserId: text().notNull(),
    state: text({ enum: ['invited', 'activated', 'replaced'] }).notNull(),
    invitedAt: timestamp({ withTimezone: true }).notNull(),
    activatedAt: timestamp({ withTimezone: true }),
    replacedAt: timestamp({ withTimezone: true }),
    /** The assignment that replaced this one. */
    replacedBy: uuid().references((): AnyPgColumn => reportingOfficerAssignments.id),
    createdBy: text().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('reporting_officer_assignments_current_key')
      .on(table.commissionId)
      .where(sql`${table.state} <> 'replaced'`),
    index('reporting_officer_assignments_keycloak_user_id_idx').on(table.keycloakUserId),
    check(
      'reporting_officer_assignments_state_check',
      sql`${table.state} in ('invited', 'activated', 'replaced')`,
    ),
    check(
      'reporting_officer_assignments_activated_at_check',
      sql`${table.state} <> 'activated' or ${table.activatedAt} is not null`,
    ),
    check(
      'reporting_officer_assignments_replaced_at_check',
      sql`(${table.state} = 'replaced') = (${table.replacedAt} is not null)`,
    ),
    // Set in the same transaction as the replacement, once the replacing row exists (the current
    // key admits it only after this row is `replaced`), so it cannot be required here.
    check(
      'reporting_officer_assignments_replaced_by_check',
      sql`${table.replacedBy} is null or (${table.state} = 'replaced' and ${table.replacedBy} <> ${table.id})`,
    ),
  ],
);

export const commissionsSchema = {
  commissions,
  officerCategories,
  commissionCategories,
  tenantPolicyVersions,
  reportingOfficerAssignments,
};
