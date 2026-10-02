import type { FieldEnvelope } from '@adili/data-access';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { Decision, PackageKind } from '../decision.js';
import type { Scope } from '../scope.js';
import type { WrittenNotice } from '../written-notice.js';

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
 *
 * The officer named may be resolved to a roster record whose officer has not onboarded (spec 10
 * decision 2): `resolved_person_id` stays null until they do (linked by the roster record, on the
 * directory's `declarant.onboarded.v1` or when the workflow reads the record), and meanwhile the
 * access officer serves the notice in writing (r.22(2)) and records the day it was served.
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
    /** The declarant: null until the roster record's officer has onboarded. */
    resolvedPersonId: uuid(),
    resolvedName: text(),
    resolvedFileNumber: text(),
    resolvedBy: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    /**
     * When the officer resolved to a record without an account was invited to onboard (the
     * directory sends it to the roster's contacts); null when not invited.
     */
    declarantInvitedAt: timestamp({ withTimezone: true }),
    /**
     * When the declarant was notified (online, or the start of the day a written notice was
     * served), and when their window for representations ends.
     */
    notifiedAt: timestamp({ withTimezone: true }),
    windowEndsAt: timestamp({ withTimezone: true }),
    /** The written notice the access officer recorded (r.22(2)); null when told online. */
    writtenNotice: jsonb().$type<WrittenNotice>(),
    /**
     * The decision served in writing on a declarant with no account, as the access officer
     * recorded it (spec 10 decision 2); null until then, and for a declarant told online.
     */
    decisionWrittenNotice: jsonb().$type<WrittenNotice>(),
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    /**
     * Received + the Commission's decision period at receipt (policy `access.decisionDays`, thirty
     * days by default).
     */
    decisionDeadlineAt: timestamp({ withTimezone: true }).notNull(),
    decision: jsonb().$type<Decision>(),
    /** When it closed without a decision: withdrawn, or the officer cannot be identified. */
    closedAt: timestamp({ withTimezone: true }),
    /**
     * The Confidential document a grant delivered (its `access-package`, or the nil letter when
     * the scope holds nothing), and until when its recipient may download it.
     */
    packageKind: text().$type<PackageKind>(),
    packageDocumentId: uuid(),
    packageVerificationId: text(),
    packageIssuedAt: timestamp({ withTimezone: true }),
    downloadExpiresAt: timestamp({ withTimezone: true }),
    /** When issuing it failed after its retries; cleared once it is issued. */
    packageFailedAt: timestamp({ withTimezone: true }),
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
    index('access_requests_roster_record_idx').on(table.resolvedRosterRecordId),
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
 * closes. The text is the declarant's own words to the access officer: made online by the
 * declarant, or received in writing and entered by the access officer on their behalf (a
 * declarant served a written notice, r.22(2)).
 */
export const representations = pgTable('representations', {
  requestId: uuid()
    .primaryKey()
    .references(() => accessRequests.id),
  tenant: text().notNull(),
  /** The declarant (the request's `resolved_person_id`); null until they have onboarded. */
  personId: uuid(),
  stance: text().$type<RepresentationStance>().notNull(),
  text: text().notNull(),
  attachments: jsonb().$type<RepresentationAttachment[]>().notNull().default([]),
  /** Received in writing and entered by the access officer, who is `recorded_by`. */
  receivedInWriting: boolean().notNull().default(false),
  /** Token subject and name of the access officer who entered them; null when made online. */
  recordedBy: text(),
  recordedByName: text(),
  submittedAt: timestamp({ withTimezone: true }).notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const requestsSchema = { accessRequests, representations };
