import type { FieldEnvelope } from '@adili/data-access';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { Decision } from '../decision.js';
import type { Scope } from '../scope.js';

/**
 * Form K access requests (Act s.36(1), Regs r.22) and the declarant's representations on them
 * (s.36(3)). The applicant's particulars and the Form K text are personal: the whole `form-k.v1`
 * document is stored encrypted under the Commission's key (ADR-006); only what the queue, the
 * declarant's notice and the decision need stays in clear (the applicant's name, the officer
 * sought as Part II names them, the scope).
 *
 * Row-level security (migration `access_rls`): the Commission's context (`app.tenant`) reads and
 * writes its requests; the applicant reads their own (`app.person` = `applicant_person_id`); the
 * declarant reads a request about them once notified (`resolved_person_id`, `notified_at`) and
 * writes their representations on it.
 */

/** access.yaml `AccessRequestStatus`. */
export const ACCESS_REQUEST_STATUSES = [
  /** Received with its `ARQ` reference; the officer named in it is not resolved yet. */
  'submitted',
  /** A passport applicant's request, held until the access officer verifies their identity. */
  'pending-applicant-verification',
  /** The access officer has not resolved the officer named in Part II to a roster record yet. */
  'officer-unresolved',
  /** The declarant is notified; their window for representations is open. */
  'awaiting-representations',
  /** The window closed (or the declarant consented); the access officer decides. */
  'under-decision',
  'granted',
  'partially-granted',
  'denied',
  /** The officer named in Part II matches no roster record of the Commission: closed. */
  'cannot-identify',
  /** The applicant withdrew it before a decision: closed. */
  'withdrawn',
] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

/** The statuses of a decided request: the access officer's outcome, final (spec 10). */
export const DECIDED_STATUSES = [
  'granted',
  'partially-granted',
  'denied',
] as const satisfies readonly AccessRequestStatus[];
export type DecidedStatus = (typeof DECIDED_STATUSES)[number];

/** Statuses after which nothing changes the request but its package's downloads and expiry. */
export const CLOSED_STATUSES = [
  'granted',
  'partially-granted',
  'denied',
  'cannot-identify',
  'withdrawn',
] as const satisfies readonly AccessRequestStatus[];

/**
 * Whether the applicant's identity is established (access.yaml `applicantIdentityStatus`): a
 * national ID checked against IPRS at onboarding, or a passport the access officer verified.
 */
export const APPLICANT_IDENTITY_STATUSES = ['verified', 'pending-verification'] as const;
export type ApplicantIdentityStatus = (typeof APPLICANT_IDENTITY_STATUSES)[number];

/** The officer whose declaration is sought, as Form K Part II names them. */
export interface OfficerSought {
  name: string;
  entity: string;
  workStation: string;
  personnelFileNumber?: string;
}

/** The access officer's manual check of a passport applicant's particulars. */
export interface ApplicantVerification {
  verified: boolean;
  /** What was checked; no document numbers. */
  note: string;
  /** Token subject and name of the access officer. */
  by: string;
  byName: string;
  /** ISO 8601. */
  at: string;
}

export const accessRequests = pgTable(
  'access_requests',
  {
    id: uuid().primaryKey(),
    /** The Responsible Commission the request is addressed to (form-k.v1 `responsibleCommission`). */
    tenant: text().notNull(),
    /** The Commission's name when the request was received, as the request shows it. */
    commissionName: text().notNull(),
    /** `ARQ-<ISSUER>-<YEAR>-<SEQ>-<CHECK>` (ADR-011), allocated at submission. */
    reference: text().notNull().unique(),
    /** The applicant's person record (token `person_id`) and account (token `sub`). */
    applicantPersonId: uuid().notNull(),
    applicantSubject: text().notNull(),
    /** Form K Part I name: shown to the access officer and, once notified, to the declarant. */
    applicantName: text().notNull(),
    applicantIdentityStatus: text().$type<ApplicantIdentityStatus>().notNull(),
    applicantVerification: jsonb().$type<ApplicantVerification>(),
    /**
     * The `form-k.v1` document as submitted (with `meta` filled), encrypted under the Commission's
     * key; the record id bound into it is `access-request:<id>`.
     */
    formKCiphertext: text().notNull(),
    formKEnvelope: jsonb().$type<FieldEnvelope>().notNull(),
    officerSought: jsonb().$type<OfficerSought>().notNull(),
    /** The scope requested (form-k.v1 `scope`). */
    scope: jsonb().$type<Scope>().notNull(),
    status: text().$type<AccessRequestStatus>().notNull(),
    /**
     * The roster record and person the access officer resolved Part II to, with its full name and
     * personnel file number as the roster had them then.
     */
    resolvedRosterRecordId: uuid(),
    resolvedPersonId: uuid(),
    resolvedName: text(),
    resolvedFileNumber: text(),
    resolvedBy: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    /** When the declarant was notified, and when their window for representations ends. */
    notifiedAt: timestamp({ withTimezone: true }),
    windowEndsAt: timestamp({ withTimezone: true }),
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    /** Received + `ACCESS_DECISION_DAYS` (30). */
    decisionDeadlineAt: timestamp({ withTimezone: true }).notNull(),
    decision: jsonb().$type<Decision>(),
    /** When it closed without a decision: withdrawn, or the officer cannot be identified. */
    closedAt: timestamp({ withTimezone: true }),
    /** The Confidential `access-package` of a grant, and until when its recipient may download it. */
    packageDocumentId: uuid(),
    packageVerificationId: text(),
    packageIssuedAt: timestamp({ withTimezone: true }),
    downloadExpiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('access_requests_queue_idx').on(
      table.tenant,
      table.status,
      table.decisionDeadlineAt,
      table.id,
    ),
    index('access_requests_applicant_idx').on(table.applicantPersonId, table.submittedAt),
    index('access_requests_declarant_idx').on(table.resolvedPersonId, table.notifiedAt),
  ],
);

/** access.yaml `Representations.stance`. */
export const REPRESENTATION_STANCES = ['object', 'consent', 'context'] as const;
export type RepresentationStance = (typeof REPRESENTATION_STANCES)[number];

/** A clean upload of purpose `access-representation` attached to representations. */
export interface RepresentationAttachment {
  uploadId: string;
  fileName: string;
}

/**
 * The declarant's representations on a request: one per request, editable until the window
 * closes. The text is the declarant's own words to the access officer.
 */
export const representations = pgTable('representations', {
  requestId: uuid()
    .primaryKey()
    .references(() => accessRequests.id),
  tenant: text().notNull(),
  /** The declarant (the request's `resolved_person_id`). */
  personId: uuid().notNull(),
  stance: text().$type<RepresentationStance>().notNull(),
  text: text().notNull(),
  attachments: jsonb().$type<RepresentationAttachment[]>().notNull().default([]),
  submittedAt: timestamp({ withTimezone: true }).notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const requestsSchema = { accessRequests, representations };
