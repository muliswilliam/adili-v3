import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { formKDraftSchema } from '../access/form-k';
import {
  accessClient,
  type AccessClient,
  subjectDocumentsClient,
  type SubjectDocumentsClient,
} from './access/client.server';
import {
  listRequests,
  loadApplicant,
  loadNewRequest,
  loadRequest,
  type NewRequestResult,
  type PackageDownloadResult,
  readPackageDownload,
  type RequestListResult,
  type RequestResult,
  submitRequest,
  type SubmitResult,
  withdrawRequest,
  type WithdrawResult,
} from './access-requests.server';
import { getBff } from './bff.server';
import { directoryClient, type DirectoryClient } from './directory/client.server';
import type { Unauthenticated } from './results';
import { type WithNow, withNow } from './with-now';

/** Server functions for the applicant's access requests (spec 10). Tokens stay on the server. */

interface ApplicantClients {
  access: AccessClient;
  directory: DirectoryClient;
  documents: SubjectDocumentsClient;
}

/** Runs `call` with the access, directory and documents clients for the signed-in applicant. */
async function asApplicant<T>(
  call: (clients: ApplicantClients) => Promise<T>,
): Promise<T | Unauthenticated> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { status: 'unauthenticated' };
  return call({
    access: accessClient(session.accessToken),
    directory: directoryClient(session.accessToken),
    documents: subjectDocumentsClient(session.accessToken),
  });
}

/**
 * Whether the signed-in user is an applicant (the directory has their applicant record), so the
 * portal's home can send them to My requests instead of the declarant dashboard.
 */
export const isSignedInApplicant = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const result = await asApplicant(({ directory }) => loadApplicant(directory));
    return result.status === 'ok';
  },
);

export const getNewAccessRequest = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.uuid().optional() }))
  .handler(({ data }): Promise<WithNow<NewRequestResult | Unauthenticated>> =>
    withNow(asApplicant(({ directory, access }) => loadNewRequest(directory, access, data.from))),
  );

export const submitAccessRequest = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      draft: formKDraftSchema,
      /** One per wizard, reused on retry. */
      idempotencyKey: z.uuid(),
    }),
  )
  .handler(({ data }): Promise<SubmitResult | Unauthenticated> =>
    asApplicant(({ directory, access }) =>
      submitRequest(directory, access, data.draft, data.idempotencyKey, new Date()),
    ),
  );

export const getMyAccessRequests = createServerFn({ method: 'GET' }).handler(
  (): Promise<WithNow<RequestListResult | Unauthenticated>> =>
    withNow(asApplicant(({ access }) => listRequests(access))),
);

export const getMyAccessRequest = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: z.uuid() }))
  .handler(({ data }): Promise<WithNow<RequestResult | Unauthenticated>> =>
    withNow(asApplicant(({ access }) => loadRequest(access, data.requestId))),
  );

export const withdrawMyAccessRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ requestId: z.uuid(), idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<WithdrawResult | Unauthenticated> =>
    asApplicant(({ access }) => withdrawRequest(access, data.requestId, data.idempotencyKey)),
  );

/**
 * A short-lived link to a granted request's package, from the documents service, fetched on
 * each click: documents serves it to the applicant (its subject) until the window closes.
 */
export const getMyPackageDownload = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(({ data }): Promise<PackageDownloadResult | Unauthenticated> =>
    asApplicant(({ documents }) => readPackageDownload(documents, data.documentId)),
  );
