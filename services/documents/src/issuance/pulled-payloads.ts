import {
  CLARIFICATION_LETTER,
  DECISION_LETTER,
  DISCIPLINARY_REFERRAL,
  type DocumentType,
  NOTICE_TO_COMPLY,
  REFERRAL_PACKAGE,
  SALARY_STOPPAGE,
  WARNING,
} from '@adili/events/contracts';
import { EACC_ROLES } from '@adili/roles';
import { z } from 'zod';

import type { ReviewRecord } from '../review/review-client.js';

/**
 * Documents whose fields another service holds (ADR-013: the issue request names the record, the
 * payload is pulled), so no personal data travels in the request, its logs or the caller's
 * workflow history. All of them are the review service's.
 */

/** What an issue request of a pulled type carries as its payload: the record's id, by name. */
export interface PulledPayload {
  /** The review service's record the fields are pulled for. */
  record: ReviewRecord;
  /** The payload's one property, e.g. `determinationId`. */
  idField: string;
  /** The issue request's payload, as the contract names it (e.g. `DecisionLetterSource`). */
  source: z.ZodType<Record<string, string>>;
  /** The subject a document of the record is issued under: one per record. */
  subjectRef(id: string): string;
  /**
   * Who may download it, checked against the pulled `declarantPersonId` (which the template does
   * not print): `declarant` must name a person; `declarant-if-onboarded` may name none (an officer
   * who never onboarded); `nobody` refuses any subject person (a Confidential referral package
   * the declarant is never told of).
   */
  owner: 'declarant' | 'declarant-if-onboarded' | 'nobody';
  /**
   * EACC roles who may download a document of the type issued by any Commission, with a token of
   * the EACC tenant (spec 09: the referral packages Commissions send EACC). None: nobody at EACC.
   * The database admits the EACC tenant to these types only (issued_documents_eacc_read).
   */
  eaccReaders?: readonly string[];
}

function source(idField: string, description: string): z.ZodType<Record<string, string>> {
  return z.strictObject({ [idField]: z.uuid() }).meta({ description });
}

export const clarificationLetterSource = source(
  'clarificationId',
  "A clarification-letter's payload: the clarification whose letter this is; the fields the template renders are pulled from the review service's letter payload endpoint",
);
export const decisionLetterSource = source(
  'determinationId',
  "A decision-letter's payload: the approved determination whose letter this is; the fields are pulled from the review service (internalGetDeterminationLetterPayload)",
);
export const actionLetterSource = source(
  'actionId',
  'The payload of a step letter (notice-to-comply, warning, salary-stoppage, disciplinary-referral): the approved administrative action whose letter this is; the fields are pulled from the review service (internalGetActionLetterPayload)',
);
export const referralPackageSource = source(
  'referralId',
  "A referral-package's payload: the approved referral whose evidence package this is; the cover sheet, manifest and evidence are pulled from the review service (internalGetReferralPackagePayload)",
);

const actionLetter: PulledPayload = {
  record: 'action',
  idField: 'actionId',
  source: actionLetterSource,
  subjectRef: (id) => `action:${id}`,
  owner: 'declarant-if-onboarded',
};

const PULLED: Partial<Record<DocumentType, PulledPayload>> = {
  [CLARIFICATION_LETTER]: {
    record: 'clarification',
    idField: 'clarificationId',
    source: clarificationLetterSource,
    subjectRef: (id) => `clarification:${id}`,
    owner: 'declarant',
  },
  [DECISION_LETTER]: {
    record: 'determination',
    idField: 'determinationId',
    source: decisionLetterSource,
    subjectRef: (id) => `determination:${id}`,
    owner: 'declarant',
  },
  [NOTICE_TO_COMPLY]: actionLetter,
  [WARNING]: actionLetter,
  [SALARY_STOPPAGE]: actionLetter,
  [DISCIPLINARY_REFERRAL]: actionLetter,
  [REFERRAL_PACKAGE]: {
    record: 'referral',
    idField: 'referralId',
    source: referralPackageSource,
    subjectRef: (id) => `referral:${id}`,
    owner: 'nobody',
    eaccReaders: EACC_ROLES,
  },
};

/**
 * The document types an EACC account holding `roles` may download from any Commission: those
 * whose `eaccReaders` include one of its roles.
 */
export function eaccReadableTypes(roles: readonly string[]): DocumentType[] {
  return (Object.keys(PULLED) as DocumentType[]).filter((type) =>
    PULLED[type]?.eaccReaders?.some((role) => roles.includes(role)),
  );
}

/** How a document of `type` gets its fields, or undefined when the request carries them. */
export function pulledPayloadOf(type: DocumentType): PulledPayload | undefined {
  return PULLED[type];
}
