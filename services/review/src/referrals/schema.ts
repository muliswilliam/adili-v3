import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { PROPOSER_KINDS } from '../approvals/schema.js';

/**
 * Referrals to EACC (spec 08, Regs r.20). Tenant data under the same row-level security as every
 * review table. The declarant never reads them: there is no person policy, and nothing about a
 * referral is sent to them (spec 08, "Why the declarant is not told of a referral").
 */

/**
 * review.yaml `ReferralGrounds`: undeclared or unexplained assets (r.20(1)(c), a reviewer's
 * proposal from a case), or two missed cycles and an unanswered clarification (r.20(2), the
 * system's).
 */
export const REFERRAL_GROUNDS = [
  'undeclared-assets',
  'unexplained-assets',
  'two-missed-cycles',
  'unanswered-clarification',
] as const;
export type ReferralGrounds = (typeof REFERRAL_GROUNDS)[number];

/** The grounds a reviewer proposes from a case; the others are the referral sweep's. */
export const REVIEWER_GROUNDS = ['undeclared-assets', 'unexplained-assets'] as const;
export const SYSTEM_GROUNDS = ['two-missed-cycles', 'unanswered-clarification'] as const;

/** review.yaml `ReferralStatus`. */
export const REFERRAL_STATUSES = ['proposed', 'approved', 'declined', 'sent'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** What a referral rests on (review.yaml `Referral.sources`): identifiers only. */
export interface ReferralSources {
  caseIds: string[];
  flagIds: string[];
  clarificationIds: string[];
  obligationIds: string[];
  actionIds: string[];
}

/** review.yaml `ReferralManifestItem.kind`: what an item of the evidence package is. */
export const MANIFEST_KINDS = [
  'declaration-version',
  'declaration-attachment',
  'flag',
  'clarification',
  'clarification-attachment',
  'obligation',
  'letter',
] as const;
export type ManifestKind = (typeof MANIFEST_KINDS)[number];

/**
 * One item of the evidence package's manifest: what it is, the reference it is known by, and the
 * SHA-256 of its content as the package includes it (a pulled version's canonical JSON, a flag's,
 * an upload's or a letter's own hash). `documentId` names an issued document of the documents
 * service (letters) or an upload (attachments); null for records of this service.
 */
export interface ManifestItem {
  kind: ManifestKind;
  reference: string;
  sha256: string;
  documentId: string | null;
}

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * A referral to EACC: proposed by a reviewer from a case, or by the referral sweep (`system`);
 * approved or declined by a supervisor the separation-of-duties rule admits. Approval allocates
 * the `RFL` reference; the Confidential evidence package is then assembled by pull (manifest
 * first, then the package document), and the referral is `sent` with `referral.sent.v1`.
 */
export const referrals = pgTable(
  'referrals',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    personId: uuid().notNull(),
    /** The case it was proposed from (or whose clarification went unanswered); null otherwise. */
    caseId: uuid(),
    /** The cycle it is about: the case's, or the later missed biennial cycle's. */
    cycleYear: integer().notNull(),
    grounds: text({ enum: REFERRAL_GROUNDS }).notNull(),
    proposerKind: text({ enum: PROPOSER_KINDS }).notNull(),
    /** The proposing officer's subject; null for a system proposal. */
    proposer: text(),
    proposerName: text(),
    proposedAt: timestamp({ withTimezone: true }).notNull(),
    sources: jsonb().$type<ReferralSources>().notNull(),
    narrative: text().notNull(),
    status: text({ enum: REFERRAL_STATUSES }).notNull(),
    approver: text(),
    approverName: text(),
    approvedAt: timestamp({ withTimezone: true }),
    declinedBy: text(),
    declinedByName: text(),
    declinedAt: timestamp({ withTimezone: true }),
    declineNote: text(),
    /** `RFL-<ISSUER>-<YEAR>-<SEQ>-<CHECK>` (ADR-011), allocated at approval. */
    reference: text(),
    /** The package's manifest, built by pull after approval, before the package is issued. */
    packageManifest: jsonb().$type<ManifestItem[]>(),
    packageDocumentId: uuid(),
    packageVerificationId: text(),
    sentAt: timestamp({ withTimezone: true }),
    /**
     * ICMS's case number once EACC registered the sent referral there (spec 09,
     * `referral.icms-registered.v1`): the Commission follows up with it. Null until then.
     */
    icmsCaseNumber: text(),
    /** When ICMS registered it. */
    icmsRegisteredAt: timestamp({ withTimezone: true }),
    /** Read model for the Referrals view: confidential, tenant-scoped. */
    declarantName: text().notNull(),
    personnelFileNumber: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('referrals_reference_key').on(table.reference),
    // The sweep proposes once per person, grounds and cycle, whatever became of the proposal.
    uniqueIndex('referrals_system_proposal_key')
      .on(table.tenant, table.personId, table.grounds, table.cycleYear)
      .where(sql`${table.proposerKind} = 'system'`),
    index('referrals_tenant_status_idx').on(table.tenant, table.status, table.proposedAt),
    index('referrals_tenant_proposed_idx').on(table.tenant, table.proposedAt, table.id),
    index('referrals_case_id_idx').on(table.caseId),
    check('referrals_grounds_check', sql`${table.grounds} in (${inList(REFERRAL_GROUNDS)})`),
    check('referrals_status_check', sql`${table.status} in (${inList(REFERRAL_STATUSES)})`),
    check(
      'referrals_proposer_kind_check',
      sql`${table.proposerKind} in (${inList(PROPOSER_KINDS)})`,
    ),
  ],
);

export const referralsSchema = { referrals };
