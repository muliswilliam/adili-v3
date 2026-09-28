import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import {
  type ClarificationPageResult,
  loadClarificationPage,
  respondToClarification,
  type RespondResult,
} from './clarifications.server';
import type { Unauthenticated } from './declarations';
import { reviewClient, type ReviewClient } from './review/client.server';

/** Server functions for the declarant's clarifications (spec 07a). Tokens stay on the server. */

async function asDeclarant<T>(
  call: (client: ReviewClient) => Promise<T>,
): Promise<T | Unauthenticated> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { status: 'unauthenticated' };
  return call(reviewClient(session.accessToken));
}

/** The page, and the server's clock so the countdown reads the same on server and browser. */
export type ClarificationPageLoad = (ClarificationPageResult | Unauthenticated) & { now: string };

export const getMyClarification = createServerFn({ method: 'GET' })
  .validator(z.object({ clarificationId: z.uuid() }))
  .handler(async ({ data }): Promise<ClarificationPageLoad> => ({
    ...(await asDeclarant((client) => loadClarificationPage(client, data.clarificationId))),
    now: new Date().toISOString(),
  }));

export const respondToMyClarification = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      clarificationId: z.uuid(),
      /** One per form, reused on retry. */
      idempotencyKey: z.uuid(),
      items: z
        .array(
          z.object({
            index: z.number().int().min(0),
            text: z.string().min(1).max(2000),
            attachments: z.array(z.uuid()).max(10),
          }),
        )
        .min(1)
        .max(50),
    }),
  )
  .handler(({ data }): Promise<RespondResult | Unauthenticated> =>
    asDeclarant((client) =>
      respondToClarification(client, data.clarificationId, data.items, data.idempotencyKey),
    ),
  );
