import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { APPROVAL_KINDS, INBOX_KINDS } from '../approvals/kinds';
import {
  type ApprovalsPage,
  loadApprovals,
  loadSupervisors,
  reassignApproval,
} from './approvals.server';
import { asReviewer } from './as-viewer.server';
import { SLUG_PATTERN } from './directory/contract';
import type { Assignee } from './review/types';
import type { ServiceResult } from './service-call';

/** Server functions for the supervisors' approvals inbox (spec 08, S14). */

const inboxKind = z.enum(INBOX_KINDS);

export type ApprovalsLoad = ServiceResult<ApprovalsPage> & { now: string };

export const getApprovals = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().regex(SLUG_PATTERN),
      kind: inboxKind,
      cursor: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }): Promise<ApprovalsLoad> => {
    const now = new Date().toISOString();
    return {
      ...(await asReviewer((client) =>
        loadApprovals(client, data.slug, { kind: data.kind, cursor: data.cursor }),
      )),
      now,
    };
  });

export const reassignToSupervisor = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kind: z.enum(APPROVAL_KINDS),
      subjectId: z.uuid(),
      toSupervisor: z.string().min(1).max(200),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<{ reassignedTo: Assignee }>> =>
    asReviewer((client) => reassignApproval(client, data.kind, data.subjectId, data.toSupervisor)),
  );

/** The Commission's other supervisors, for the reassign dialog. */
export const getSupervisors = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string().regex(SLUG_PATTERN) }))
  .handler(({ data }): Promise<ServiceResult<Assignee[]>> =>
    asReviewer((client, { subject }) => loadSupervisors(client, data.slug, subject)),
  );
