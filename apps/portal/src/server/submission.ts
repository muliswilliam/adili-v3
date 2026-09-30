import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asDeclarant } from './bff.server';
import { loadDeclarantAccount } from './declarant.server';
import { declarationsClient } from './declarations/client.server';
import { directoryClient } from './directory/client.server';
import { documentsClient } from './documents/client.server';
import type { Unauthenticated } from './results';
import {
  type AcknowledgementRead,
  loadSubmission,
  readAcknowledgement,
  readSlipDownload,
  reissueAcknowledgement,
  type ReissueOutcome,
  type SlipDownload,
  type SubmissionLoad,
  submitDeclaration,
  type SubmitOutcome,
} from './submission.server';

/** Server functions for submitting a declaration (spec 06). Tokens stay on the server. */

export const submitMyDeclaration = createServerFn({ method: 'POST' })
  .validator(z.object({ declarationId: z.uuid(), idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<SubmitOutcome | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => submitDeclaration(client, data)),
  );

export const getMySubmission = createServerFn({ method: 'GET' })
  .validator(z.object({ declarationId: z.uuid() }))
  .handler(({ data }): Promise<SubmissionLoad | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => loadSubmission(client, data.declarationId)),
  );

const versionRef = z.object({ declarationId: z.uuid(), version: z.number().int().min(1) });

export const getMyAcknowledgement = createServerFn({ method: 'GET' })
  .validator(versionRef)
  .handler(({ data }): Promise<AcknowledgementRead | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => readAcknowledgement(client, data)),
  );

export const reissueMyAcknowledgement = createServerFn({ method: 'POST' })
  .validator(versionRef)
  .handler(({ data }): Promise<ReissueOutcome | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => reissueAcknowledgement(client, data)),
  );

/**
 * A short-lived link to the issued slip, from the documents service (the acknowledgement's
 * `downloadUrl` is null: the slip is the declarant's document there, and downloads are audited).
 */
export const getMySlipDownload = createServerFn({ method: 'GET' })
  .validator(z.object({ documentId: z.uuid() }))
  .handler(({ data }): Promise<SlipDownload | Unauthenticated> =>
    asDeclarant(documentsClient, (client) => readSlipDownload(client, data.documentId)),
  );

/** What the slip card shows besides the acknowledgement. */
export interface SlipContext {
  status: 'ok';
  /**
   * The declarant's name and where the slip was sent (masked on the server); null when the
   * directory did not answer.
   */
  declarant: { fullName: string; maskedEmail: string | null; maskedPhone: string | null } | null;
}

export const getMySlipContext = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SlipContext | Unauthenticated> => {
    const account = await asDeclarant(directoryClient, loadDeclarantAccount);
    if (account.status === 'unauthenticated') return account;
    return {
      status: 'ok',
      declarant:
        account.status === 'onboarded'
          ? {
              fullName: account.account.fullName,
              maskedEmail: account.account.maskedEmail,
              maskedPhone: account.account.maskedPhone,
            }
          : null,
    };
  },
);
