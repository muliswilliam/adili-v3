import type {
  AccessLegalBasis,
  AccessRegisterKind,
  AccessSubjectKind,
} from '@adili/events/contracts';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The access register (ADR-008, Administrative Mechanisms 28-34): one append-only entry per step
 * of every access request, law enforcement request and self-access, with who acted, when, and the
 * law it rests on. Each entry is also an event, recorded in the same transaction. Entries are
 * never updated or deleted (trigger `access_register_insert_only`).
 *
 * Row-level security (migration `access_rls`): the Commission's context reads and writes its
 * entries; anyone who may see the request (applicant, notified declarant, filing law enforcement
 * officer) reads its entries; the declarant reads their own self-access entries.
 */
export const accessRegister = pgTable(
  'access_register',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    subjectKind: text().$type<AccessSubjectKind>().notNull(),
    /** The access request, law enforcement request or certified copy. */
    subjectId: uuid().notNull(),
    /** The request's `ARQ` or `LEA` reference; null for self-access. */
    reference: text(),
    /** The declarant whose declaration is accessed, once known (resolved, or self-access). */
    personId: uuid(),
    kind: text().$type<AccessRegisterKind>().notNull(),
    /** Token subject of who acted and their name; null for the service's own steps. */
    actor: text(),
    actorName: text(),
    legalBasis: text().$type<AccessLegalBasis>().notNull(),
    at: timestamp({ withTimezone: true }).notNull(),
    /**
     * Facts of the step for the timeline and who-accessed views (outcome, grounds, scope,
     * representative's name): never the reasons text, the Form K text or declaration content.
     */
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('access_register_subject_idx').on(table.subjectId, table.at),
    index('access_register_person_idx').on(table.personId, table.at),
    index('access_register_tenant_idx').on(table.tenant, table.at),
  ],
);

export const registerSchema = { accessRegister };
