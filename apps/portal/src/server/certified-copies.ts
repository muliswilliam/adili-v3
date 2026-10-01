import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { accessClient, subjectDocumentsClient } from './access/client.server';
import { asDeclarant } from './bff.server';
import {
  type CopiesResult,
  type CopyDownloadResult,
  type CopyResult,
  listCopies,
  readCopy,
  readCopyDownload,
  requestCopy,
} from './certified-copies.server';
import { declarationsClient } from './declarations/client.server';
import { loadSubmittedVersions, type SubmittedVersionsResult } from './my-declarations.server';
import type { Unauthenticated } from './results';

/**
 * Server functions for certified copies of the declarant's submitted versions (spec 10 FE-4,
 * S13): ask for one, follow it until issued, download it. Tokens stay on the server.
 */

export type CertifiedCopiesLoad =
  { status: 'ok'; versions: SubmittedVersionsResult; copies: CopiesResult } | Unauthenticated;

/** The Certified copies page: every submitted version, and the copies asked for so far. */
export const getMyCertifiedCopiesPage = createServerFn({ method: 'GET' }).handler(
  (): Promise<CertifiedCopiesLoad> =>
    asDeclarant(
      (token) => ({ access: accessClient(token), declarations: declarationsClient(token) }),
      async ({ access, declarations }) => {
        const [versions, copies] = await Promise.all([
          loadSubmittedVersions(declarations),
          listCopies(access),
        ]);
        return { status: 'ok' as const, versions, copies };
      },
    ),
);

/** The copies asked for so far, for the versions of a declaration in My declarations. */
export const getMyCertifiedCopies = createServerFn({ method: 'GET' }).handler(
  (): Promise<CopiesResult | Unauthenticated> => asDeclarant(accessClient, listCopies),
);

export const requestMyCertifiedCopy = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      commission: z.string().min(1),
      declarationId: z.uuid(),
      version: z.number().int().min(1),
      idempotencyKey: z.uuid(),
    }),
  )
  .handler(({ data }): Promise<CopyResult | Unauthenticated> => {
    const { idempotencyKey, ...body } = data;
    return asDeclarant(accessClient, (client) => requestCopy(client, body, idempotencyKey));
  });

export const getMyCertifiedCopy = createServerFn({ method: 'GET' })
  .validator(z.object({ copyId: z.uuid() }))
  .handler(({ data }): Promise<CopyResult | Unauthenticated> =>
    asDeclarant(accessClient, (client) => readCopy(client, data.copyId)),
  );

export const getMyCertifiedCopyDownload = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(({ data }): Promise<CopyDownloadResult | Unauthenticated> =>
    asDeclarant(subjectDocumentsClient, (client) => readCopyDownload(client, data.documentId)),
  );
