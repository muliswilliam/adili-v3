import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { LADDER_STEPS } from '../actions/ladder';
import {
  type ActionStatus,
  type AdministrativeAction,
  approveStep,
  declineStep,
  type Ladder,
  type LadderPage,
  loadLadder,
  loadLadders,
  restartLadder,
} from './actions.server';
import { asReviewer, withViewerClient } from './as-viewer.server';
import { SLUG_PATTERN } from './directory/contract';
import { reviewDocumentsClient } from './review/documents-client.server';
import { callService, type ServiceResult } from './service-call';

export type { AdministrativeAction, Ladder, LadderPage };

/**
 * Server functions for the Actions screens (spec 08 FE-5), called as the signed-in reviewer or
 * supervisor. The review service applies the separation-of-duties rule and answers 404 to anyone
 * outside the Commission's review staff.
 */

const ACTION_STATUSES = [
  'proposed',
  'approved',
  'approved-pending-payroll',
  'declined',
  'issued',
  'responded',
  'complied',
  'reinstated',
  'cancelled',
] as const satisfies readonly ActionStatus[];

export const getLadders = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().regex(SLUG_PATTERN),
      status: z.enum(ACTION_STATUSES).optional(),
      step: z.enum(LADDER_STEPS).optional(),
      cursor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100),
    }),
  )
  .handler(({ data: { slug, ...query } }): Promise<ServiceResult<LadderPage>> =>
    asReviewer((client) => loadLadders(client, slug, query)),
  );

export const getLadder = createServerFn({ method: 'GET' })
  .validator(z.object({ ladderId: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<Ladder>> =>
    asReviewer((client) => loadLadder(client, data.ladderId)),
  );

export const approveLadderStep = createServerFn({ method: 'POST' })
  .validator(z.object({ actionId: z.uuid(), idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<AdministrativeAction>> =>
    asReviewer((client) => approveStep(client, data.actionId, data.idempotencyKey)),
  );

export const declineLadderStep = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      actionId: z.uuid(),
      note: z.string().trim().min(1).max(2000),
      idempotencyKey: z.uuid(),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<AdministrativeAction>> =>
    asReviewer((client) => declineStep(client, data.actionId, data.note, data.idempotencyKey)),
  );

export const restartDeclinedLadder = createServerFn({ method: 'POST' })
  .validator(z.object({ ladderId: z.uuid(), idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<Ladder>> =>
    asReviewer((client) => restartLadder(client, data.ladderId, data.idempotencyKey)),
  );

export interface LetterLink {
  downloadUrl: string;
}

/**
 * A step letter, through the documents service's audited download: staff download a Restricted
 * letter by its document id, as they do a determination letter (spec 08 contract convergence).
 */
export const getStepLetterLink = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(async ({ data }): Promise<ServiceResult<LetterLink>> => {
    const result = await withViewerClient(reviewDocumentsClient, (documents) =>
      callService(() =>
        documents.GET('/v1/documents/{documentId}/download', {
          params: { path: { documentId: data.documentId } },
        }),
      ),
    );
    return result.ok ? { ok: true, data: { downloadUrl: result.data.downloadUrl } } : result;
  });
