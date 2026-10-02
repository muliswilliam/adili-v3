import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  PROOF_CONTENT_TYPES,
  PROOF_MAX_BYTES,
} from '../components/access/self-access/proof-upload';
import { selfAccessDocumentsClient } from './access/documents-client.server';
import type { RosterCandidates } from './access/types';
import { asAccessViewer, withViewerClient } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import type { Upload, UploadReservation } from './documents/client';
import {
  completeProofUpload,
  type CopyDownload,
  copyDownload,
  declarantVersions,
  type DeclarantVersions,
  listApplications,
  loadApplication,
  markDelivered,
  recordApplication,
  reserveProofUpload,
  searchDeclarants,
  type SelfAccessApplicationDetail,
  type SelfAccessPage,
  type SelfAccessResult,
} from './self-access.server';

/**
 * Server functions of the Certified copies screens (spec 10 slice #302): the access officer
 * records a declarant's written self-access application, follows its certified copy until it
 * is issued, prints it and marks it collected or dispatched; the supervisor reads. Tokens stay
 * on the server; the copy comes back as a short-lived link.
 */

const id = z.uuid();

function asDocumentsOfficer<T>(
  work: (client: ReturnType<typeof selfAccessDocumentsClient>) => Promise<SelfAccessResult<T>>,
) {
  return withViewerClient(selfAccessDocumentsClient, work);
}

export const findDeclarants = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, q: z.string().trim().min(2).max(200) }))
  .handler(({ data }): Promise<SelfAccessResult<RosterCandidates>> =>
    asAccessViewer((client) => searchDeclarants(client, data.slug, data.q)),
  );

export const getDeclarantVersions = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, rosterRecordId: id }))
  .handler(({ data }): Promise<SelfAccessResult<DeclarantVersions>> =>
    asAccessViewer((client) => declarantVersions(client, data.slug, data.rosterRecordId)),
  );

const applicationInput = z.object({
  rosterRecordId: id,
  declarationId: id,
  version: z.int().min(1),
  identityNote: z.string().trim().min(1).max(1000),
  representative: z
    .object({
      name: z.string().trim().min(1).max(200),
      idNumber: z.string().trim().min(1).max(50),
      authorityUploadId: id,
      idUploadId: id,
    })
    .nullable(),
  deliveryMethod: z.enum(['collection', 'dispatch']),
});

export const recordSelfAccessApplication = createServerFn({ method: 'POST' })
  .validator(z.object({ slug: commissionSlug, input: applicationInput, idempotencyKey: id }))
  .handler(({ data }): Promise<SelfAccessResult<SelfAccessApplicationDetail>> =>
    asAccessViewer((client) =>
      recordApplication(client, data.slug, data.input, data.idempotencyKey),
    ),
  );

export const getSelfAccessApplications = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, cursor: z.string().max(500).optional() }))
  .handler(({ data }): Promise<SelfAccessResult<SelfAccessPage>> =>
    asAccessViewer((client) => listApplications(client, data.slug, data.cursor)),
  );

export const getSelfAccessApplication = createServerFn({ method: 'GET' })
  .validator(z.object({ applicationId: id }))
  .handler(({ data }): Promise<SelfAccessResult<SelfAccessApplicationDetail>> =>
    asAccessViewer((client) => loadApplication(client, data.applicationId)),
  );

export const markSelfAccessDelivered = createServerFn({ method: 'POST' })
  .validator(z.object({ applicationId: id, idempotencyKey: id }))
  .handler(({ data }): Promise<SelfAccessResult<SelfAccessApplicationDetail>> =>
    asAccessViewer((client) => markDelivered(client, data.applicationId, data.idempotencyKey)),
  );

export const createProofUpload = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      contentType: z.enum(PROOF_CONTENT_TYPES),
      declaredSize: z.int().min(1).max(PROOF_MAX_BYTES),
      fileName: z.string().min(1).max(255),
      idempotencyKey: id,
    }),
  )
  .handler(({ data: { idempotencyKey, ...input } }): Promise<SelfAccessResult<UploadReservation>> =>
    asDocumentsOfficer((client) => reserveProofUpload(client, input, idempotencyKey)),
  );

export const completeProof = createServerFn({ method: 'POST' })
  .validator(z.object({ id, idempotencyKey: id }))
  .handler(({ data }): Promise<SelfAccessResult<Upload>> =>
    asDocumentsOfficer((client) => completeProofUpload(client, data.id, data.idempotencyKey)),
  );

export const getCertifiedCopyLink = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: id }))
  .handler(({ data }): Promise<SelfAccessResult<CopyDownload>> =>
    asDocumentsOfficer((client) => copyDownload(client, data.documentId)),
  );
