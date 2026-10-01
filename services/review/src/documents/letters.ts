import { ApplicationFailure } from '@temporalio/common';

import type { DirectoryClient } from '../directory/directory-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import type { DocumentsClient, IssuedDocument, ReviewLetter } from './documents-client.js';

/** The services issuing a letter reads and calls. */
export interface LetterDeps {
  directory: DirectoryClient;
  documents: DocumentsClient;
}

/**
 * One Restricted letter of the review service (ADR-010): what it is and the record whose payload
 * documents pulls, the Commission issuing it, the person who may download it, and what its verify
 * page shows.
 */
export type LetterRequest = ReviewLetter & {
  tenant: string;
  templateVersion: number;
  /** The owning record, e.g. `clarification:<uuid>`. */
  subjectRef: string;
  /** Null for an officer who never onboarded. */
  subjectPersonId: string | null;
  reference: string;
  issuedAt: Date;
  /** Failure type of the letter when documents refuses it (not retried). */
  refused: string;
};

/**
 * Asks documents to render, sign and register the letter, as issued by the Commission's name. A
 * letter documents refuses (`InternalApiRejected`) fails without retry under the request's
 * `refused` type: asked again, it would be refused again. An unreachable documents or directory
 * service propagates, so a workflow activity is retried.
 */
export async function issueLetter(
  { directory, documents }: LetterDeps,
  request: LetterRequest,
): Promise<IssuedDocument> {
  const commission = await directory.getCommission(request.tenant);
  const letter = { type: request.type, payload: request.payload } as ReviewLetter;
  try {
    return await documents.issue({
      ...letter,
      templateVersion: request.templateVersion,
      disclosureLevel: 'restricted',
      issuerTenant: request.tenant,
      subjectRef: request.subjectRef,
      subjectPersonId: request.subjectPersonId,
      publicPayload: {
        reference: request.reference,
        type: request.type,
        issuer: commission.name,
        issuedAt: request.issuedAt.toISOString(),
      },
    });
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
