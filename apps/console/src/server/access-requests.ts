import { REGULATION_24_GROUNDS } from '@adili/ui';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { queueSearchSchema } from '../components/access/queue-query';
import { accessClient } from './access/client.server';
import type {
  AttachmentDownload,
  OfficerRequestView,
  QueuePage,
  RosterCandidates,
} from './access/types';
import {
  type AccessResult,
  attachmentLink,
  decideRequest,
  loadQueue,
  loadRequest,
  resolveOfficer,
  searchRoster,
  verifyApplicant,
} from './access-requests.server';
import { withViewerClient } from './as-viewer.server';
import { commissionSlug } from './commission-slug';

/**
 * Server functions of the Access requests workspace (spec 10 FE-5), called as the signed-in
 * access officer or supervisor. Tokens stay on the server; attachment downloads come back as
 * short-lived links.
 */

const id = z.uuid();

function asOfficer<T>(work: (client: ReturnType<typeof accessClient>) => Promise<AccessResult<T>>) {
  return withViewerClient(accessClient, work);
}

export const getAccessQueue = createServerFn({ method: 'GET' })
  .validator(queueSearchSchema.extend({ slug: commissionSlug }))
  .handler(({ data }): Promise<AccessResult<QueuePage>> => {
    const { slug, ...search } = data;
    return asOfficer((client) => loadQueue(client, slug, search));
  });

export const getAccessRequest = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asOfficer((client) => loadRequest(client, data.requestId)),
  );

export const findRosterCandidates = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id, q: z.string().trim().min(2).max(200) }))
  .handler(({ data }): Promise<AccessResult<RosterCandidates>> =>
    asOfficer((client) => searchRoster(client, data.requestId, data.q)),
  );

export const resolveRequestedOfficer = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: id, rosterRecordId: id.nullable(), idempotencyKey: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asOfficer((client) =>
      resolveOfficer(client, data.requestId, data.rosterRecordId, data.idempotencyKey),
    ),
  );

export const verifyApplicantIdentity = createServerFn({ method: 'POST' })
  .validator(
    z.object({ requestId: id, note: z.string().trim().min(1).max(1000), idempotencyKey: id }),
  )
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asOfficer((client) => verifyApplicant(client, data.requestId, data.note, data.idempotencyKey)),
  );

const grounds = z.enum(REGULATION_24_GROUNDS);
const scope = z.strictObject({
  years: z.array(z.int().min(2025)).min(1).max(50),
  includeSpouses: z.boolean(),
  includeChildren: z.boolean(),
  sections: z.array(z.enum(['bio', 'income', 'assets', 'liabilities', 'other'])).min(1),
  includeClarifications: z.boolean(),
});

/** The decision as the form sends it; the access service applies the rules between fields. */
export const decisionInputSchema = z.strictObject({
  outcome: z.enum(['grant', 'partial-grant', 'deny']),
  grantedScope: scope.nullable().optional(),
  grounds: z.array(grounds).max(4).optional(),
  reasons: z.string().trim().min(1).max(4000),
});

export const decideAccessRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: id, input: decisionInputSchema, idempotencyKey: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asOfficer((client) => decideRequest(client, data.requestId, data.input, data.idempotencyKey)),
  );

export const getRepresentationAttachmentLink = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id, uploadId: id }))
  .handler(({ data }): Promise<AccessResult<AttachmentDownload>> =>
    asOfficer((client) => attachmentLink(client, data.requestId, data.uploadId)),
  );
