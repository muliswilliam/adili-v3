import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { PROPOSER_KINDS } from '../approvals/schema.js';
import { reviewCases } from '../cases/schema.js';

/**
 * Compliance determinations (spec 08). Tenant data under the same row-level security as every
 * review table; a declarant reads their own approved determinations through `app.person`.
 */

/** review.yaml `DeterminationOutcome`. `compliant-no-issues` is the bulk closure's (system). */
export const DETERMINATION_OUTCOMES = [
  'compliant',
  'compliant-no-issues',
  'non-compliant',
  'further-action',
] as const;
export type DeterminationOutcome = (typeof DETERMINATION_OUTCOMES)[number];

/** review.yaml `ProposalStatus`. */
export const PROPOSAL_STATUSES = ['proposed', 'approved', 'returned', 'withdrawn'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Determinations that hold the case: at most one per case at a time. */
export const OPEN_PROPOSAL_STATUSES = ['proposed', 'approved'] as const;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * A compliance determination of a review case: proposed by the assignee (or the system), then
 * approved, returned or withdrawn. Approval allocates the `CMP` reference and the decision letter
 * is requested; a returned one stays as it was and the revision is a new proposal.
 */
export const determinations = pgTable(
  'determinations',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    personId: uuid().notNull(),
    outcome: text({ enum: DETERMINATION_OUTCOMES }).notNull(),
    reasons: text().notNull(),
    furtherActionNote: text(),
    proposerKind: text({ enum: PROPOSER_KINDS }).notNull(),
    /** The proposing officer's subject; null for a system proposal. */
    proposer: text(),
    proposerName: text(),
    proposedAt: timestamp({ withTimezone: true }).notNull(),
    status: text({ enum: PROPOSAL_STATUSES }).notNull(),
    approver: text(),
    approverName: text(),
    approvedAt: timestamp({ withTimezone: true }),
    returnedBy: text(),
    returnedByName: text(),
    returnedAt: timestamp({ withTimezone: true }),
    returnReason: text(),
    withdrawnAt: timestamp({ withTimezone: true }),
    /** `CMP-<ISSUER>-<YEAR>-<SEQ>-<CHECK>` (ADR-011), allocated at approval. */
    reference: text(),
    letterDocumentId: uuid(),
    letterVerificationId: text(),
    /** The supervisor's bulk approval that approved this system closure, if one did. */
    bulkApprovalId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('determinations_reference_key').on(table.reference),
    // One proposed or approved determination per case; returned and withdrawn ones are history.
    uniqueIndex('determinations_open_case_key')
      .on(table.caseId)
      .where(sql`${table.status} in (${inList(OPEN_PROPOSAL_STATUSES)})`),
    index('determinations_case_id_idx').on(table.caseId),
    index('determinations_tenant_status_idx').on(table.tenant, table.status, table.proposedAt),
    index('determinations_person_status_idx').on(table.personId, table.status),
    index('determinations_bulk_approval_idx').on(table.bulkApprovalId),
    check(
      'determinations_outcome_check',
      sql`${table.outcome} in (${inList(DETERMINATION_OUTCOMES)})`,
    ),
    check('determinations_status_check', sql`${table.status} in (${inList(PROPOSAL_STATUSES)})`),
    check(
      'determinations_proposer_kind_check',
      sql`${table.proposerKind} in (${inList(PROPOSER_KINDS)})`,
    ),
  ],
);

export const determinationsSchema = { determinations };
