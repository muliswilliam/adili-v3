import { ApplicationFailure } from '@temporalio/common';

import { InternalApiRejected } from '../internal-api/rejected.js';
import type { DocumentsClient, IssuedDocument, ReviewLetter } from './documents-client.js';

/**
 * One Restricted letter of the review service (ADR-010): what it is and the record whose payload
 * documents pulls, the Commission issuing it and the person who may download it. What its verify
 * page shows is the template's.
 */
export type LetterRequest = ReviewLetter & {
  tenant: string;
  templateVersion: number;
  /** The owning record, e.g. `clarification:<uuid>`. */
  subjectRef: string;
  /** Null for an officer who never onboarded. */
  subjectPersonId: string | null;
  /** Failure type of the letter when documents refuses it (not retried). */
  refused: string;
};

/**
 * Asks documents to render, sign and register the letter for the Commission. A letter documents
 * refuses (`InternalApiRejected`) fails without retry under the request's `refused` type: asked
 * again, it would be refused again. An unreachable documents service propagates, so a workflow
 * activity is retried.
 */
export async function issueLetter(
  documents: DocumentsClient,
  request: LetterRequest,
): Promise<IssuedDocument> {
  const letter = { type: request.type, payload: request.payload } as ReviewLetter;
  try {
    return await documents.issue(
      {
        ...letter,
        templateVersion: request.templateVersion,
        subjectRef: request.subjectRef,
        subjectPersonId: request.subjectPersonId,
      },
      request.tenant,
    );
  } catch (error) {
    if (error instanceof InternalApiRejected) {
      throw ApplicationFailure.nonRetryable(
        `Documents refused the letter of ${request.subjectRef} (${String(error.status)})`,
        request.refused,
      );
    }
    throw error;
  }
}
