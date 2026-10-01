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

export const getRepresentationAttachmentLink = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id, uploadId: id }))
  .handler(({ data }): Promise<AccessResult<AttachmentDownload>> =>
    asOfficer((client) => attachmentLink(client, data.requestId, data.uploadId)),
  );
