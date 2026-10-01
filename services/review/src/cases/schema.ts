import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { Evidence, ItemRef } from '../rules/index.js';

/**
 * The review database (spec 07a): review cases, their risk flags, assignment history,
 * clarifications with the declarant's responses, internal notes and the case timeline. Only this
 * service reads or writes it (ADR-013).
 *
 * No declaration content is stored: the case view and the rules pull the document from the
 * declarations service each time. Flag evidence holds clear facts only (percentages, counts,
 * dates, item and person references). The declarant's name and personnel file number are the one
 * read model kept, for queue search; they are confidential and tenant-scoped.
 *
 * Row-level security (migration 0002): every table is tenant data for staff and system
 * transactions (`app.tenant`, or `platform`); a declarant reads their own clarifications and
 * responses across Commissions through `app.person`.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** review.yaml `DeclarationType`. */
export const DECLARATION_TYPES = ['initial', 'biennial', 'final'] as const;
export type DeclarationType = (typeof DECLARATION_TYPES)[number];

/**
 * review.yaml `CaseStatus`. Spec 07a moves cases through the first five; spec 08 adds the rest.
 */
export const CASE_STATUSES = [
  'unassigned',
  'assigned',
  'awaiting-clarification',
  'clarified',
  'ready-for-determination',
  'sample-review',
  'further-action',
  'determined',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** review.yaml `PriorityBand`. */
export const PRIORITY_BANDS = ['low', 'medium', 'high'] as const;

/** review.yaml `Severity`. */
export const FLAG_SEVERITIES = ['info', 'low', 'medium', 'high'] as const;

/**
 * review.yaml `Flag.closedReason`: why a flag no longer counts. A registry flag a later check of
 * the same registry no longer raises is `superseded-by-recheck` (spec 07b); reviewed or not, it
 * keeps its note.
 */
export const FLAG_CLOSED_REASONS = ['superseded-by-recheck'] as const;
export type FlagClosedReason = (typeof FLAG_CLOSED_REASONS)[number];

/** How a case's assignee changed: the reviewer-of-record history spec 08 reads. */
export const ASSIGNMENT_KINDS = ['claimed', 'released', 'reassigned', 'unassigned'] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/** review.yaml `ClarificationStatus`. */
export const CLARIFICATION_STATUSES = [
  'draft',
  'issued',
  'responded',
  'resolved',
  'overdue',
  'withdrawn',
] as const;
export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number];

/** Clarifications the declarant still has to answer. */
export const OPEN_CLARIFICATION_STATUSES = ['issued', 'overdue'] as const;

/** review.yaml `Requirement` (Act s.35(4)). */
export const REQUIREMENTS = ['provide-omitted', 'explain-discrepancy', 'correct'] as const;

/** Kinds of timeline entry; later slices add theirs. */
export type TimelineKind =
  | 'case-created'
  | 'version-processed'
  | 'assigned'
  | 'flag-reviewed'
  | 'note-added'
  | 'clarification-issued'
  | 'clarification-responded'
  | 'clarification-resolved'
  | 'clarification-withdrawn'
  | 'clarification-follow-up'
  | 'clarification-overdue'
  | 'clarification-reminder-sent'
  | 'status-changed'
  | 'determination-proposed'
  | 'determination-approved'
  | 'determination-returned'
  | 'determination-withdrawn'
  | 'sampled-for-review'
  | 'registry-checked'
  | 'registry-rechecked';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * One review case per declaration, created by `DeclarationProcessingWorkflow` from its first
 * processed version; later versions update it (the workflow's amendment path).
 */
export const reviewCases = pgTable(
  'review_cases',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    declarationId: uuid().notNull(),
    currentVersionId: uuid().notNull(),
    currentVersion: integer().notNull(),
    personId: uuid().notNull(),
    /** The declaration's reference number (ADR-011). */
    reference: text().notNull(),
    type: text({ enum: DECLARATION_TYPES }).notNull(),
    statementDate: date({ mode: 'string' }).notNull(),
    /** The statement date's year: the queue's cycle filter. */
    cycleYear: integer().notNull(),
    /** Receipt (Act s.35(2)): the submission of version 1. An amendment never moves it. */
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    /** Receipt plus the Commission policy's clarification issue window. */
    windowEndsAt: timestamp({ withTimezone: true }).notNull(),
    late: boolean().notNull(),
    /** Weighted sum of the open flags' severities; orders the queue and nothing else. */
    score: integer().notNull(),
    band: text({ enum: PRIORITY_BANDS }).notNull(),
    status: text({ enum: CASE_STATUSES }).notNull(),
    assignee: text(),
    assigneeName: text(),
    claimedAt: timestamp({ withTimezone: true }),
    /** Read model for queue search: confidential, tenant-scoped. */
    declarantName: text().notNull(),
    personnelFileNumber: text().notNull(),
    /**
     * The roster record of the obligation the declaration was filed for, from the version: a
     * clarification's ladder stops and resumes the salary on it. Null for cases processed before it
     * was recorded.
     */
    rosterRecordId: uuid(),
    /** That roster record's reporting entity: the bulk closure filter. */
    reportingEntityId: uuid(),
    openFlags: integer().notNull().default(0),
    /**
     * Whether a registry could not be checked for someone on the case at its latest registry check
     * (spec 07b): the queue's filter and icon. Kept with `registry_checks` in one transaction.
     */
    registryUnavailable: boolean().notNull().default(false),
    /**
     * Registry checks of the case are numbered as they start (re-check, sweep and processing run
     * them on their own workflows): the last number handed out, and the number of the check whose
     * statuses are stored. A check that started before the stored one is stale and stores nothing,
     * so a slow check never overwrites a newer one.
     */
    registryCheckSequence: integer().notNull().default(0),
    storedRegistryCheck: integer().notNull().default(0),
    openClarifications: integer().notNull().default(0),
    /** When the closure sweep diverted the case to review instead of proposing its closure. */
    sampledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('review_cases_declaration_id_key').on(table.declarationId),
    // The queue's order: score descending, then oldest first.
    index('review_cases_queue_idx').on(
      table.tenant,
      table.status,
      table.score.desc(),
      table.receivedAt,
    ),
    index('review_cases_tenant_score_idx').on(
      table.tenant,
      table.score.desc(),
      table.receivedAt,
      table.id,
    ),
    index('review_cases_tenant_assignee_idx').on(table.tenant, table.assignee),
    // The closure sweep's eligibility: a cycle's low-band cases, by status.
    index('review_cases_closure_idx').on(table.tenant, table.cycleYear, table.band, table.status),
    // The hourly sweep of cases with a registry still unavailable (spec 07b): few, across tenants.
    index('review_cases_registry_unavailable_idx')
      .on(table.id)
      .where(sql`${table.registryUnavailable}`),
    check('review_cases_type_check', sql`${table.type} in (${inList(DECLARATION_TYPES)})`),
    check('review_cases_band_check', sql`${table.band} in (${inList(PRIORITY_BANDS)})`),
    check('review_cases_status_check', sql`${table.status} in (${inList(CASE_STATUSES)})`),
  ],
);

/**
 * Every submitted version a case has processed, as the version's metadata gave it: number,
 * submission, lateness and whether it amended an earlier one. Facts only, no content.
 */
export const reviewCaseVersions = pgTable(
  'review_case_versions',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    versionId: uuid().notNull(),
    version: integer().notNull(),
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    late: boolean().notNull(),
    amendment: boolean().notNull(),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('review_case_versions_case_version_key').on(table.caseId, table.version)],
);

/** Every assignment change of a case, in order: who reviewed it (separation of duties, spec 08). */
export const reviewAssignments = pgTable(
  'review_assignments',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    /** The assignee after the change; null when the case went back to the queue. */
    subject: text(),
    subjectName: text(),
    kind: text({ enum: ASSIGNMENT_KINDS }).notNull(),
    by: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('review_assignments_case_id_idx').on(table.caseId),
    check('review_assignments_kind_check', sql`${table.kind} in (${inList(ASSIGNMENT_KINDS)})`),
  ],
);

/** A risk flag: an indicator for the reviewer's judgement, never a finding. */
export const reviewFlags = pgTable(
  'review_flags',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    /** The version whose processing raised it. */
    versionId: uuid().notNull(),
    ruleId: text().notNull(),
    severity: text({ enum: FLAG_SEVERITIES }).notNull(),
    title: text().notNull(),
    indicator: text().notNull(),
    /** Clear facts only: percentages, counts, dates and codes, never amounts or descriptions. */
    evidence: jsonb().$type<Evidence>().notNull(),
    itemRefs: jsonb().$type<ItemRef[]>().notNull(),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewedBy: text(),
    reviewNote: text(),
    /** A reviewed flag kept when a later version was processed; its evidence is of its version. */
    recomputed: boolean().notNull().default(false),
    /** Why the flag no longer counts toward the score or the open flags; null while it does. */
    closedReason: text({ enum: FLAG_CLOSED_REASONS }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('review_flags_case_id_idx').on(table.caseId),
    check('review_flags_severity_check', sql`${table.severity} in (${inList(FLAG_SEVERITIES)})`),
    check(
      'review_flags_closed_reason_check',
      sql`${table.closedReason} in (${inList(FLAG_CLOSED_REASONS)})`,
    ),
  ],
);

/** One item of a clarification: what it concerns and what Act s.35(4) requires of the declarant. */
export interface ClarificationItem {
  id: string;
  sectionKey: string | null;
  personKey: string | null;
  itemId: string | null;
  requirement: (typeof REQUIREMENTS)[number];
  text: string;
}

/**
 * What an issued clarification's letter says, fixed when it is issued: the Commission and, per
 * item, what it concerns (labelled from the declaration as filed), what the Act requires and the
 * reviewer's text. The documents service renders the letter from it, so a letter reads the same
 * whenever it is rendered, and serving it calls no other service (ADR-013 §7.3).
 */
export interface ClarificationLetter {
  commission: { name: string; issuerCode: string };
  items: { label: string; requirementLabel: string; text: string }[];
}

/** A written request for clarification (Act s.35(2)-(4)), numbered `CLR-…` when issued. */
export const clarifications = pgTable(
  'clarifications',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    personId: uuid().notNull(),
    /** `CLR-<ISSUER>-<YEAR>-<SEQ>-<CHECK>` (ADR-011); null while a draft. */
    reference: text(),
    status: text({ enum: CLARIFICATION_STATUSES }).notNull(),
    items: jsonb().$type<ClarificationItem[]>().notNull(),
    issuedAt: timestamp({ withTimezone: true }),
    dueAt: timestamp({ withTimezone: true }),
    respondedAt: timestamp({ withTimezone: true }),
    responseLate: boolean(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolutionNote: text(),
    /** Set when issued. */
    letter: jsonb().$type<ClarificationLetter>(),
    letterDocumentId: uuid(),
    letterVerificationId: text(),
    followUpOf: uuid(),
    withdrawnReason: text(),
    createdBy: text().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('clarifications_reference_key').on(table.reference),
    index('clarifications_case_id_idx').on(table.caseId),
    index('clarifications_person_status_idx').on(table.personId, table.status),
    index('clarifications_tenant_status_idx').on(table.tenant, table.status),
    check(
      'clarifications_status_check',
      sql`${table.status} in (${inList(CLARIFICATION_STATUSES)})`,
    ),
  ],
);

/** An item's answer: text and the uploads attached to it. */
export interface ClarificationResponseItem {
  itemId: string;
  text: string;
}

export interface ClarificationResponseAttachment {
  itemId: string;
  uploadId: string;
  fileName: string;
  sha256: string;
}

/** The declarant's one response to a clarification. */
export const clarificationResponses = pgTable('clarification_responses', {
  clarificationId: uuid()
    .primaryKey()
    .references(() => clarifications.id),
  tenant: text().notNull(),
  personId: uuid().notNull(),
  items: jsonb().$type<ClarificationResponseItem[]>().notNull(),
  attachments: jsonb().$type<ClarificationResponseAttachment[]>().notNull(),
  submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** An internal note on a case; the declarant never sees it. */
export const reviewNotes = pgTable(
  'review_notes',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    author: text().notNull(),
    authorName: text(),
    text: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_notes_case_id_idx').on(table.caseId)],
);

/** What happened to a case, in order; a summary line and the id of what it is about. */
export const reviewTimeline = pgTable(
  'review_timeline',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => reviewCases.id),
    kind: text().$type<TimelineKind>().notNull(),
    /** The version, flag, clarification or note the entry is about; null for the case itself. */
    ref: text(),
    actor: text().notNull(),
    summary: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_timeline_case_id_at_idx').on(table.caseId, table.at)],
);

export const casesSchema = {
  reviewCases,
  reviewCaseVersions,
  reviewAssignments,
  reviewFlags,
  clarifications,
  clarificationResponses,
  reviewNotes,
  reviewTimeline,
};
