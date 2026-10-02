import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { accessClient } from './access/client.server';
import type { AccessCommission, LeaRequest, RosterCandidates } from './access/types';
import type { AccessResult } from './access-requests.server';
import { withViewerClient } from './as-viewer.server';
import { packageDocumentsClient } from './documents/package-client.server';
import {
  decideLeaRequest,
  listMyLeaRequests,
  listRequestCommissions,
  loadLeaRequest,
  packageDownload,
  type PackageDownloadResult,
  searchLeaRoster,
  submitLeaRequest,
  verifyLeaRequest,
} from './lea-requests.server';

/**
 * Server functions for law enforcement requests (spec 10 FE-6), called as the signed-in access
 * officer (or supervisor) of a Commission, or as a law enforcement officer. Tokens stay on the
 * server; a package download comes back as a short-lived link.
 */

const id = z.uuid();
const idempotencyKey = z.uuid();

/** Loose bounds only: the access service validates, and its 400 problem maps back to the form. */
const scope = z.object({
  years: z.array(z.int()).max(50),
  includeSpouses: z.boolean(),
  includeChildren: z.boolean(),
  sections: z.array(z.enum(['bio', 'income', 'assets', 'liabilities', 'other'])).max(5),
  includeClarifications: z.boolean(),
});

function asViewer<T>(work: (client: ReturnType<typeof accessClient>) => Promise<AccessResult<T>>) {
  return withViewerClient(accessClient, work);
}

export const getLeaRequest = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id }))
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asViewer((client) => loadLeaRequest(client, data.requestId)),
  );

export const findLeaRosterCandidates = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: id, q: z.string().trim().min(2).max(200) }))
  .handler(({ data }): Promise<AccessResult<RosterCandidates>> =>
    asViewer((client) => searchLeaRoster(client, data.requestId, data.q)),
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
    asViewer((client) =>
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
      input: z.object({
        outcome: z.enum(['grant', 'partial-grant', 'deny']),
        grantedScope: scope.nullable().optional(),
        grounds: z
          .array(
            z.enum([
              'public-interest',
              'prejudice-proceeding',
              'frivolous-vexatious',
              'not-objectives',
            ]),
          )
          .max(4)
          .optional(),
        reasons: z.string().max(5000),
      }),
    }),
  )
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asViewer((client) => decideLeaRequest(client, data.requestId, data.input, data.idempotencyKey)),
  );

export const getMyLeaRequests = createServerFn({ method: 'GET' }).handler(
  (): Promise<AccessResult<LeaRequest[]>> => asViewer((client) => listMyLeaRequests(client)),
);

export const getRequestCommissions = createServerFn({ method: 'GET' }).handler(
  (): Promise<AccessResult<AccessCommission[]>> =>
    asViewer((client) => listRequestCommissions(client)),
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
        scope,
      }),
    }),
  )
  .handler(({ data }): Promise<AccessResult<LeaRequest>> =>
    asViewer((client) => submitLeaRequest(client, data.input, data.idempotencyKey)),
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
