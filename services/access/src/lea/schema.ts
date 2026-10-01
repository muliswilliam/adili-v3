import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { Decision } from '../decision.js';
import type { Scope } from '../scope.js';

/**
 * Law enforcement requests (Act s.36(2), Regs r.23): a written request by an officer of a
 * provisioned agency account (role `law-enforcement`, tenant `lea`) against a Commission, with
 * its reason and case reference, decided within fourteen days. No Form K. The declarant is told
 * only after a grant (r.23(2)), so nothing here reaches them before.
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

/** The access officer's check of the request (r.23(1)): provenance and reason. */
export interface LeaVerification {
  /** Token subject and name of the access officer. */
  by: string;
  byName: string;
  /** ISO 8601. */
  at: string;
  note: string;
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
    /** The filing officer's account (token `sub`) and name, and their agency. */
    officerSubject: text().notNull(),
    officerName: text().notNull(),
    agencyCode: text().notNull(),
    agencyName: text().notNull(),
    officerSought: jsonb().$type<LeaOfficerSought>().notNull(),
    reason: text().notNull(),
    caseReference: text().notNull(),
    scope: jsonb().$type<Scope>().notNull(),
    status: text().$type<LeaRequestStatus>().notNull(),
    resolvedRosterRecordId: uuid(),
    resolvedPersonId: uuid(),
    resolvedName: text(),
    verification: jsonb().$type<LeaVerification>(),
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    /** Received + `LEA_DECISION_DAYS` (14). */
    deadlineAt: timestamp({ withTimezone: true }).notNull(),
    /** When the access officer was reminded (day 10), and when the deadline passed undecided. */
    remindedAt: timestamp({ withTimezone: true }),
    breachedAt: timestamp({ withTimezone: true }),
    decision: jsonb().$type<Decision>(),
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
    index('lea_requests_queue_idx').on(table.tenant, table.status, table.deadlineAt, table.id),
    index('lea_requests_officer_idx').on(table.officerSubject, table.receivedAt),
    index('lea_requests_declarant_idx').on(table.resolvedPersonId),
  ],
);

export const leaSchema = { leaRequests };
