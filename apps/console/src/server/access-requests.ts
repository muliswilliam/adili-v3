import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { queueSearchSchema } from '../components/access/queue-query';
import {
  PROOF_CONTENT_TYPES,
  PROOF_MAX_BYTES,
} from '../components/access/self-access/proof-upload';
import { accessDocumentsClient } from './access/documents-client.server';
import {
  decisionInputSchema,
  representationsInputSchema,
  scopeSchema,
  writtenNoticeSchema,
} from './access/schemas';
import type {
  AttachmentDownload,
  OfficerRequestView,
  QueuePage,
  RosterCandidates,
  ScopePreview,
} from './access/types';
import {
  type AccessResult,
  attachmentLink,
  decideRequest,
  enterRepresentations,
  loadQueue,
  loadRequest,
  previewScope,
  recordDecisionWrittenNotice,
  recordWrittenNotice,
  resolveOfficer,
  searchRoster,
  verifyApplicant,
} from './access-requests.server';
import { asAccessViewer, withViewerClient } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import type { Upload, UploadReservation } from './documents/client';
import {
  completeProofUpload,
  reserveProofUpload,
  type SelfAccessResult,
} from './self-access.server';

/**
 * Server functions of the Access requests workspace (spec 10 FE-5), called as the signed-in
 * access officer or supervisor. Tokens stay on the server; attachment downloads come back as
 * short-lived links.
 */

const id = z.uuid();

export const getAccessQueue = createServerFn({ method: 'GET' })
  .validator(queueSearchSchema.extend({ slug: commissionSlug }))
  .handler(({ data }): Promise<AccessResult<QueuePage>> => {
    const { slug, ...search } = data;
    return asAccessViewer((client) => loadQueue(client, slug, search));
  });

export const getAccessRequest = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asAccessViewer((client) => loadRequest(client, data.requestId)),
  );

export const findRosterCandidates = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id, q: z.string().trim().min(2).max(200) }))
  .handler(({ data }): Promise<AccessResult<RosterCandidates>> =>
    asAccessViewer((client) => searchRoster(client, data.requestId, data.q)),
  );

export const resolveRequestedOfficer = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: id, rosterRecordId: id.nullable(), idempotencyKey: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asAccessViewer((client) =>
      resolveOfficer(client, data.requestId, data.rosterRecordId, data.idempotencyKey),
    ),
  );

export const verifyApplicantIdentity = createServerFn({ method: 'POST' })
  .validator(
    z.object({ requestId: id, note: z.string().trim().min(1).max(1000), idempotencyKey: id }),
  )
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asAccessViewer((client) =>
      verifyApplicant(client, data.requestId, data.note, data.idempotencyKey),
    ),
  );

export const decideAccessRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: id, input: decisionInputSchema, idempotencyKey: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asAccessViewer((client) =>
      decideRequest(client, data.requestId, data.input, data.idempotencyKey),
    ),
  );

/** What a scope the officer weighs holds, counted (decision 1); the supervisor may read it. */
export const previewAccessScope = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: id, scope: scopeSchema }))
  .handler(({ data }): Promise<AccessResult<ScopePreview>> =>
    asAccessViewer((client) => previewScope(client, data.requestId, data.scope)),
  );

export const recordAccessWrittenNotice = createServerFn({ method: 'POST' })
  .validator(writtenNoticeSchema.extend({ requestId: id, idempotencyKey: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asAccessViewer((client) =>
      recordWrittenNotice(client, data.requestId, data.notifiedOn, data.idempotencyKey),
    ),
  );

export const recordAccessDecisionWrittenNotice = createServerFn({ method: 'POST' })
  .validator(writtenNoticeSchema.extend({ requestId: id, idempotencyKey: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asAccessViewer((client) =>
      recordDecisionWrittenNotice(client, data.requestId, data.notifiedOn, data.idempotencyKey),
    ),
  );

export const enterWrittenRepresentations = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: id, input: representationsInputSchema, idempotencyKey: id }))
  .handler(({ data }): Promise<AccessResult<OfficerRequestView>> =>
    asAccessViewer((client) =>
      enterRepresentations(client, data.requestId, data.input, data.idempotencyKey),
    ),
  );

/**
 * A scan of the declarant's letter, uploaded as the access officer's own `access-representation`
 * file (scanned by documents) before it is attached to representations received in writing.
 */
export const createRepresentationScanUpload = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      contentType: z.enum(PROOF_CONTENT_TYPES),
      declaredSize: z.int().min(1).max(PROOF_MAX_BYTES),
      fileName: z.string().min(1).max(255),
      idempotencyKey: id,
    }),
  )
  .handler(({ data: { idempotencyKey, ...input } }): Promise<SelfAccessResult<UploadReservation>> =>
    withViewerClient(accessDocumentsClient, (client) =>
      reserveProofUpload(client, input, idempotencyKey),
    ),
  );

export const completeRepresentationScan = createServerFn({ method: 'POST' })
  .validator(z.object({ id, idempotencyKey: id }))
  .handler(({ data }): Promise<SelfAccessResult<Upload>> =>
    withViewerClient(accessDocumentsClient, (client) =>
      completeProofUpload(client, data.id, data.idempotencyKey),
    ),
  );

export const getRepresentationAttachmentLink = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id, uploadId: id }))
  .handler(({ data }): Promise<AccessResult<AttachmentDownload>> =>
    asAccessViewer((client) => attachmentLink(client, data.requestId, data.uploadId)),
  );
