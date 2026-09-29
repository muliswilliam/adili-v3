import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * What the approvals of spec 08 share: who proposed, what kind of thing waits for approval, and
 * the reassignments of an approval to another supervisor. Determinations use it now; the
 * enforcement ladder's actions and referrals plug in the same way.
 */

/** review.yaml `ProposerKind`: an officer, or the system (bulk closure, the ladder). */
export const PROPOSER_KINDS = ['system', 'user'] as const;
export type ProposerKind = (typeof PROPOSER_KINDS)[number];

/** review.yaml `ApprovalKind`: what waits in the approvals inbox. */
export const APPROVAL_KINDS = ['determination', 'action', 'referral'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * A supervisor pointing an approval at another supervisor (a conflicted one, say). Informational:
 * the separation-of-duties rule still decides who may approve. The latest row per subject is the
 * approval's preferred approver. Generic over the approval kinds, so actions and referrals use it.
 */
export const approvalReassignments = pgTable(
  'approval_reassignments',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    subjectKind: text({ enum: APPROVAL_KINDS }).notNull(),
    subjectId: uuid().notNull(),
    toSupervisor: text().notNull(),
    toSupervisorName: text(),
    by: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('approval_reassignments_subject_idx').on(table.subjectKind, table.subjectId, table.at),
    check(
      'approval_reassignments_subject_kind_check',
      sql`${table.subjectKind} in (${inList(APPROVAL_KINDS)})`,
    ),
  ],
);

export const approvalsSchema = { approvalReassignments };
