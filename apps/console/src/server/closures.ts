import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { CLOSURE_TYPES } from '../closures/search';
import { asReviewer } from './as-viewer.server';
import {
  approveClosures,
  type BulkApprovalResult,
  type ClosureFilter,
  type ClosureSummary,
  type DeclarationType,
  loadClosureSummary,
} from './closures.server';
import { SLUG_PATTERN } from './directory/contract';
import type { ServiceResult } from './service-call';

export type { BulkApprovalResult, ClosureFilter, ClosureSummary, DeclarationType };

/**
 * Server functions for the bulk closure screen (spec 08 FE-4), called as the signed-in
 * supervisor. The review service answers 403 `supervisor-required` to reviewers and 404 to
 * anyone outside the Commission's review staff.
 */

export const closureFilterSchema = z.object({
  cycleYear: z.number().int().min(2000).max(2100),
  type: z.enum(CLOSURE_TYPES).optional(),
  reportingEntityId: z.uuid().optional(),
});

const closureInput = z.object({
  slug: z.string().regex(SLUG_PATTERN),
  filter: closureFilterSchema,
});

/** `GET .../closures`: the counts and sweep for the filters; read again while approval runs. */
export const getClosureSummary = createServerFn({ method: 'GET' })
  .validator(closureInput)
  .handler(({ data }): Promise<ServiceResult<ClosureSummary>> =>
    asReviewer((client) => loadClosureSummary(client, data.slug, data.filter)),
  );

/** `POST .../closures`: approve the filters' proposals; the same key resumes a stopped run. */
export const approveBulkClosures = createServerFn({ method: 'POST' })
  .validator(closureInput.extend({ idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<BulkApprovalResult>> =>
    asReviewer((client) => approveClosures(client, data.slug, data.filter, data.idempotencyKey)),
  );
