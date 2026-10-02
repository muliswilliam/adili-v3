import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { decisionInputSchema, scopeSchema, writtenNoticeSchema } from './access/schemas';
import type { AccessCommission, LeaRequest, RosterCandidates } from './access/types';
import type { AccessResult } from './access-requests.server';
import { asAccessViewer, withViewerClient } from './as-viewer.server';
import { packageDocumentsClient } from './documents/package-client.server';
import {
  decideLeaRequest,
  listMyLeaRequests,
  listRequestCommissions,
  loadLeaRequest,
  packageDownload,
  type PackageDownloadResult,
  recordLeaWrittenNotice,
  searchLeaRoster,
  submitLeaRequest,
  verifyLeaRequest,
  withdrawLeaRequest,
} from './lea-requests.server';

/**
 * Server functions for law enforcement requests (spec 10 FE-6), called as the signed-in access
 * officer (or supervisor) of a Commission, or as a law enforcement officer. Tokens stay on the
 * server; a package download comes back as a short-lived link.
 */

const id = z.uuid();
const idempotencyKey = z.uuid();

export const getLeaRequest = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id }))
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asAccessViewer((client) => loadLeaRequest(client, data.requestId)),
  );

export const findLeaRosterCandidates = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id, q: z.string().trim().min(2).max(200) }))
  .handler(({ data }): Promise<AccessResult<RosterCandidates>> =>
    asAccessViewer((client) => searchLeaRoster(client, data.requestId, data.q)),
  );

export const verifyLea = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      requestId: id,
      rosterRecordId: id,
      note: z.string().trim().min(1).max(1000),
      idempotencyKey,
    }),
  )
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asAccessViewer((client) =>
      verifyLeaRequest(
        client,
        data.requestId,
        {
          provenanceConfirmed: true,
          reasonConfirmed: true,
          rosterRecordId: data.rosterRecordId,
          note: data.note,
        },
        data.idempotencyKey,
      ),
    ),
  );

export const decideLea = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      requestId: id,
      idempotencyKey,
      input: decisionInputSchema,
    }),
  )
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asAccessViewer((client) =>
      decideLeaRequest(client, data.requestId, data.input, data.idempotencyKey),
    ),
  );

/** The signed-in law enforcement officer withdraws one of their requests before its decision. */
export const withdrawLea = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: id, idempotencyKey }))
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asAccessViewer((client) => withdrawLeaRequest(client, data.requestId, data.idempotencyKey)),
  );

export const recordLeaNotice = createServerFn({ method: 'POST' })
  .validator(writtenNoticeSchema.extend({ requestId: id, idempotencyKey }))
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asAccessViewer((client) =>
      recordLeaWrittenNotice(client, data.requestId, data.notifiedOn, data.idempotencyKey),
    ),
  );

export const getMyLeaRequests = createServerFn({ method: 'GET' }).handler(
  (): Promise<AccessResult<LeaRequest[]>> => asAccessViewer((client) => listMyLeaRequests(client)),
);

export const getRequestCommissions = createServerFn({ method: 'GET' }).handler(
  (): Promise<AccessResult<AccessCommission[]>> =>
    asAccessViewer((client) => listRequestCommissions(client)),
);

export const sendLeaRequest = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      idempotencyKey,
      input: z.object({
        commission: z.string().max(40),
        officerSought: z.object({
          name: z.string().max(300),
          entity: z.string().max(300).optional(),
          workStation: z.string().max(300).optional(),
          personnelFileNumber: z.string().max(60).optional(),
        }),
        reason: z.string().max(5000),
        caseReference: z.string().max(200),
        scope: scopeSchema,
      }),
    }),
  )
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asAccessViewer((client) => submitLeaRequest(client, data.input, data.idempotencyKey)),
  );

/** A fresh link to the package of one of the officer's granted requests. */
export const getLeaPackageLink = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: id }))
  .handler(
    ({
      data,
    }): Promise<PackageDownloadResult | { ok: false; error: { kind: 'unauthenticated' } }> =>
      withViewerClient(packageDocumentsClient, (documents) =>
        packageDownload(documents, data.documentId),
      ),
  );
