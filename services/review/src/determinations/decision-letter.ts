import { type Database, withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import type { DirectoryClient } from '../directory/directory-client.js';
import type { DocumentsClient } from '../documents/documents-client.js';
import { issueLetter } from '../documents/letters.js';
import { systemContext } from '../system-context.js';
import { DECISION_LETTER_REFUSED } from './contract.js';
import { determinations } from './schema.js';

/** The template version of `decision-letter` this service's payload fills. */
export const DECISION_LETTER_TEMPLATE_VERSION = 1;

/** The services issuing a decision letter reads and calls. */
export interface DecisionLetterDeps {
  db: Database<ReviewSchema>;
  directory: DirectoryClient;
  documents: DocumentsClient;
}

/** What became of a request for a determination's decision letter. */
export type DecisionLetter =
  | { status: 'missing' }
  | { status: 'not-approved' }
  | { status: 'issued' | 'existing'; documentId: string; verificationId: string };

/**
 * The decision letter of an approved determination, issued at most once (ADR-010, Restricted):
 * the determination is locked while documents renders it, so the issuance workflow of an
 * individual determination and a first download of a bulk closure's letter (spec 08, on demand)
 * never issue two. The request names the determination only; documents pulls the template fields
 * from the letter payload endpoint, which reads without a lock. A letter documents refuses fails
 * without retry (`DECISION_LETTER_REFUSED`); an outage (`DocumentsUnavailable`) propagates. Either
 * way nothing is stored.
 */
export async function issueDecisionLetter(
  { db, directory, documents }: DecisionLetterDeps,
  tenant: string,
  determinationId: string,
): Promise<DecisionLetter> {
  return withTenant(db, systemContext(tenant), async (tx) => {
    const [found] = await tx
      .select()
      .from(determinations)
      .where(eq(determinations.id, determinationId))
      .for('update');
    if (!found) return { status: 'missing' };
    if (found.status !== 'approved') return { status: 'not-approved' };
    if (found.letterDocumentId !== null && found.letterVerificationId !== null) {
      return {
        status: 'existing',
        documentId: found.letterDocumentId,
        verificationId: found.letterVerificationId,
      };
    }
    if (found.reference === null || found.approvedAt === null) {
      throw new Error(`Determination ${determinationId} is approved without a reference`);
    }
    const issued = await issueLetter(
      { directory, documents },
      {
        type: 'decision-letter',
        payload: { determinationId },
        tenant,
        templateVersion: DECISION_LETTER_TEMPLATE_VERSION,
        subjectRef: `determination:${determinationId}`,
        subjectPersonId: found.personId,
        reference: found.reference,
        issuedAt: found.approvedAt,
        refused: DECISION_LETTER_REFUSED,
      },
    );
    await tx
      .update(determinations)
      .set({ letterDocumentId: issued.id, letterVerificationId: issued.verificationId })
      .where(eq(determinations.id, determinationId));
    return { status: 'issued', documentId: issued.id, verificationId: issued.verificationId };
  });
}
