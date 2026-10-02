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
   * What the pulled `declarantPersonId` (which the template does not print) is to the document:
   * its subject person, who may download it, for `declarant` (which must name a person) and
   * `declarant-if-onboarded` (which may name none: an officer who never onboarded); for
   * `excluded-declarant` the one person who must never download it (a Confidential referral
   * package the declarant is never told of; its template refuses a subject person).
   */
  owner: 'declarant' | 'declarant-if-onboarded' | 'excluded-declarant';
  /**
   * EACC roles who may download a document of the type issued by any Commission, with a token of
   * the EACC tenant (spec 09: the referral packages Commissions send EACC). None: nobody at EACC.
   * The database admits the EACC tenant to these types only (issued_documents_eacc_read).
   */
  eaccReaders?: readonly string[];
}

/**
 * A pulled type of the review service's `record`: its payload names the record by `idField`
 * (`{ "<idField>": "<uuid>" }`), and its document is issued under `<record>:<id>`.
 */
function pulledFrom(
  record: ReviewRecord,
  idField: string,
  description: string,
  who: Pick<PulledPayload, 'owner' | 'eaccReaders'>,
): PulledPayload {
  return {
    record,
    idField,
    source: z.strictObject({ [idField]: z.uuid() }).meta({ description }),
    subjectRef: (id) => `${record}:${id}`,
    ...who,
  };
}

const clarificationLetter = pulledFrom(
  'clarification',
  'clarificationId',
  "A clarification-letter's payload: the clarification whose letter this is; the fields the template renders are pulled from the review service's letter payload endpoint",
  { owner: 'declarant' },
);
const decisionLetter = pulledFrom(
  'determination',
  'determinationId',
  "A decision-letter's payload: the approved determination whose letter this is; the fields are pulled from the review service (internalGetDeterminationLetterPayload)",
  { owner: 'declarant' },
);
const actionLetter = pulledFrom(
  'action',
  'actionId',
  'The payload of a step letter (notice-to-comply, warning, salary-stoppage, disciplinary-referral): the approved administrative action whose letter this is; the fields are pulled from the review service (internalGetActionLetterPayload)',
  { owner: 'declarant-if-onboarded' },
);
const referralPackage = pulledFrom(
  'referral',
  'referralId',
  "A referral-package's payload: the approved referral whose evidence package this is; the cover sheet, manifest and evidence are pulled from the review service (internalGetReferralPackagePayload)",
  { owner: 'excluded-declarant', eaccReaders: EACC_ROLES },
);

export const clarificationLetterSource = clarificationLetter.source;
export const decisionLetterSource = decisionLetter.source;
export const actionLetterSource = actionLetter.source;
export const referralPackageSource = referralPackage.source;

const PULLED: Partial<Record<DocumentType, PulledPayload>> = {
  [CLARIFICATION_LETTER]: clarificationLetter,
  [DECISION_LETTER]: decisionLetter,
  [NOTICE_TO_COMPLY]: actionLetter,
  [WARNING]: actionLetter,
  [SALARY_STOPPAGE]: actionLetter,
  [DISCIPLINARY_REFERRAL]: actionLetter,
  [REFERRAL_PACKAGE]: referralPackage,
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
