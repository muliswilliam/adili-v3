import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { Decision, PackageKind } from '../decision.js';
import type { Scope } from '../scope.js';
import type { WrittenNotice } from '../written-notice.js';

/**
 * Law enforcement requests (Act s.36(2), Regs r.23): a written request by an officer of a
 * provisioned agency account (role `law-enforcement`, tenant `lea`) against a Commission, with
 * its reason and case reference, decided within fourteen days. No Form K. Nothing here reaches the
 * declarant (product decision, 2026-10-05; #614).
 *
 * Row-level security (migration `access_rls`): the Commission's context reads and writes its
 * requests; the filing officer reads their own (`app.tenant` `lea`, `app.subject` =
 * `officer_subject`); the declarant reads a granted request about them (`resolved_person_id`).
 */

/** access.yaml `LeaRequestStatus`. */
export const LEA_REQUEST_STATUSES = [
  /** Received with its `LEA` reference. */
  'received',
  /** The access officer checked the account's provenance and the stated reason, and resolved the officer. */
  'verified',
  /** Granted in full or in part (the decision's outcome tells which). */
  'granted',
  'denied',
  'withdrawn',
] as const;
export type LeaRequestStatus = (typeof LEA_REQUEST_STATUSES)[number];

/** The officer whose declaration is sought, as the request names them. */
export interface LeaOfficerSought {
  name: string;
  entity?: string;
  workStation?: string;
  personnelFileNumber?: string;
}

/**
 * Where a request came from (r.23(1)): the filing officer's account as the directory held it when
 * checked, at receipt and again when the access officer verifies the request.
 */
export interface LeaProvenance {
  /** `invited` or `activated`: requests from a revoked account are refused. */
  accountState: 'invited' | 'activated';
  /** ISO 8601: the account's first sign-in; null while invited. */
  activatedAt: string | null;
  /** The statute that empowers the agency, as the directory registers it. */
  agencyLegalBasis: string;
  /** ISO 8601. */
  checkedAt: string;
}

/**
 * The access officer's check of the request (r.23(1)): the account's provenance (confirmed
 * against the directory), the stated reason, and what they noted.
 */
export interface LeaVerification {
  /** Token subject and name of the access officer. */
  by: string;
  byName: string;
  /** ISO 8601. */
  at: string;
  note: string;
  provenance: LeaProvenance;
}

export const leaRequests = pgTable(
  'lea_requests',
  {
    id: uuid().primaryKey(),
    /** The Responsible Commission the request is addressed to. */
    tenant: text().notNull(),
    /** The Commission's name when the request was received, as the request shows it. */
    commissionName: text().notNull(),
    /** `LEA-<ISSUER>-<YEAR>-<SEQ>-<CHECK>` (ADR-011), allocated at receipt. */
    reference: text().notNull().unique(),
    /**
     * The filing officer's account (token `sub`), their directory person (token `person_id`), to
     * whom the package is issued and messages are sent, their name, and their agency (snapshots
     * at receipt).
     */
    officerSubject: text().notNull(),
    officerPersonId: uuid().notNull(),
    officerName: text().notNull(),
    agencyCode: text().notNull(),
    agencyName: text().notNull(),
    provenance: jsonb().$type<LeaProvenance>().notNull(),
    officerSought: jsonb().$type<LeaOfficerSought>().notNull(),
    reason: text().notNull(),
    caseReference: text().notNull(),
    scope: jsonb().$type<Scope>().notNull(),
    status: text().$type<LeaRequestStatus>().notNull(),
    resolvedRosterRecordId: uuid(),
    /** The declarant: null until the roster record's officer has onboarded (spec 10 decision 2). */
    resolvedPersonId: uuid(),
    resolvedName: text(),
    verification: jsonb().$type<LeaVerification>(),
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    /**
     * Received + the Commission's law enforcement decision period at receipt (policy
     * `access.leaDecisionDays`, fourteen days by default).
     */
    deadlineAt: timestamp({ withTimezone: true }).notNull(),
    /** When the access officer was reminded (day 10), and when the deadline passed undecided. */
    remindedAt: timestamp({ withTimezone: true }),
    breachedAt: timestamp({ withTimezone: true }),
    decision: jsonb().$type<Decision>(),
    /** What the grant delivered (package or nil letter), as for a Form K request. */
    packageKind: text().$type<PackageKind>(),
    packageDocumentId: uuid(),
    packageVerificationId: text(),
    packageIssuedAt: timestamp({ withTimezone: true }),
    downloadExpiresAt: timestamp({ withTimezone: true }),
    /** When issuing it failed after its retries; cleared once it is issued. */
    packageFailedAt: timestamp({ withTimezone: true }),
    /**
     * When the declarant was told of the grant, on requests granted before 2026-10-05; the
     * declarant is no longer told (product decision, 2026-10-05; #614).
     */
    declarantNotifiedAt: timestamp({ withTimezone: true }),
    /** When it closed without a decision: withdrawn by its officer. */
    closedAt: timestamp({ withTimezone: true }),
    /** The written notice of the grant the access officer recorded; null when told online. */
    writtenNotice: jsonb().$type<WrittenNotice>(),
    /** When the declarant without an account was invited to onboard; null when not invited. */
    declarantInvitedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('lea_requests_queue_idx').on(table.tenant, table.status, table.deadlineAt, table.id),
    index('lea_requests_officer_idx').on(table.officerSubject, table.receivedAt),
    index('lea_requests_declarant_idx').on(table.resolvedPersonId),
    index('lea_requests_roster_record_idx').on(table.resolvedRosterRecordId),
  ],
);

/** Decided: a decision is final. */
export const LEA_DECIDED_STATUSES = ['granted', 'denied'] as const satisfies LeaRequestStatus[];

/** Open: waiting for the access officer (the fourteen-day clock runs). */
export const LEA_OPEN_STATUSES = ['received', 'verified'] as const satisfies LeaRequestStatus[];

export const leaSchema = { leaRequests };
