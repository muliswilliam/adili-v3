import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  NOTE_MAX_LENGTH,
  REASONS_MAX_LENGTH,
  RETURN_REASON_MAX_LENGTH,
} from '../determination/view';
import { asReviewer, withReviewer } from './as-viewer.server';
import {
  approveDetermination,
  decisionLetterLink,
  type DeterminationResult,
  proposeDetermination,
  returnDetermination,
  withdrawDetermination,
} from './determinations.server';
import type { ServiceResult } from './service-call';
import type { Determination } from './review/types';
import { letterDocumentsClient } from './documents/letter-client.server';

/**
 * Server functions for compliance determinations (spec 08, S1 and S2), called as the signed-in
 * reviewer or supervisor. The review service decides who may propose, approve, return and
 * withdraw (the separation-of-duties rule); tokens stay on the server.
 */

const id = z.uuid();

const signedOut = <T>(): DeterminationResult<T> => ({
  ok: false,
  refusal: null,
  error: { kind: 'unauthenticated' },
});

/** review.yaml `DeterminationInput`, as the proposal dialog sends it. */
export const determinationInput = z.object({
  outcome: z.enum(['compliant', 'non-compliant', 'further-action']),
  reasons: z.string().trim().min(1).max(REASONS_MAX_LENGTH),
  furtherActionNote: z.string().trim().max(NOTE_MAX_LENGTH).nullable(),
});

export const proposeCaseDetermination = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, input: determinationInput, idempotencyKey: id }))
  .handler(({ data }): Promise<DeterminationResult<Determination>> =>
    withReviewer(
      (client) =>
        proposeDetermination(
          client,
          data.caseId,
          {
            outcome: data.input.outcome,
            reasons: data.input.reasons,
            furtherActionNote:
              data.input.outcome === 'further-action' && data.input.furtherActionNote
                ? data.input.furtherActionNote
                : null,
          },
          data.idempotencyKey,
        ),
      signedOut<Determination>,
    ),
  );

export const approveCaseDetermination = createServerFn({ method: 'POST' })
  .validator(z.object({ determinationId: id, idempotencyKey: id }))
  .handler(({ data }): Promise<DeterminationResult<Determination>> =>
    withReviewer(
      (client) => approveDetermination(client, data.determinationId, data.idempotencyKey),
      signedOut<Determination>,
    ),
  );

export const returnCaseDetermination = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      determinationId: id,
      reason: z.string().trim().min(1).max(RETURN_REASON_MAX_LENGTH),
    }),
  )
  .handler(({ data }): Promise<DeterminationResult<Determination>> =>
    withReviewer(
      (client) => returnDetermination(client, data.determinationId, data.reason),
      signedOut<Determination>,
    ),
  );

export const withdrawCaseDetermination = createServerFn({ method: 'POST' })
  .validator(z.object({ determinationId: id }))
  .handler(({ data }): Promise<DeterminationResult<Determination>> =>
    withReviewer(
      (client) => withdrawDetermination(client, data.determinationId),
      signedOut<Determination>,
    ),
  );

/**
 * A short-lived link to an approved determination's decision letter: review names the letter
 * (issuing it on first request for a bulk closure), and the documents service hands out the link
 * as the signed-in officer, audited there.
 */
export const getDecisionLetterLink = createServerFn({ method: 'GET' })
  .validator(z.object({ determinationId: id }))
  .handler(({ data }): Promise<ServiceResult<{ downloadUrl: string }>> =>
    asReviewer((client, { accessToken }) =>
      decisionLetterLink(client, letterDocumentsClient(accessToken), data.determinationId),
    ),
  );
