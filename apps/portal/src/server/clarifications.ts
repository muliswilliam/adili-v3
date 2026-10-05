import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asDeclarant as asDeclarantOf } from './bff.server';
import {
  type ClarificationPageResult,
  loadClarificationPage,
  loadMyClarifications,
  type MyClarificationsResult,
  respondToClarification,
  type RespondResult,
} from './clarifications.server';
import type { Unauthenticated } from './results';
import { reviewClient, type ReviewClient } from './review/client.server';

/** Server functions for the declarant's clarifications (spec 07a). Tokens stay on the server. */

function asDeclarant<T>(call: (client: ReviewClient) => Promise<T>) {
  return asDeclarantOf(reviewClient, call);
}

/** The page, and the server's clock so the countdown reads the same on server and browser. */
export type ClarificationPageLoad = (ClarificationPageResult | Unauthenticated) & { now: string };

/** The list, and the server's clock so countdowns read the same on server and browser. */
export type MyClarificationsLoad = (MyClarificationsResult | Unauthenticated) & { now: string };

export const getMyClarifications = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyClarificationsLoad> => ({
    ...(await asDeclarant(loadMyClarifications)),
    now: new Date().toISOString(),
  }),
);

/**
 * The list for a card that streams in: an ended session or a failed call reads as unavailable,
 * so the card stays away instead of the page failing.
 */
export async function myClarificationsOrUnavailable(): Promise<MyClarificationsLoad> {
  const load = await getMyClarifications().catch(
    () => ({ status: 'unavailable', now: new Date().toISOString() }) as const,
  );
  return load.status === 'unauthenticated' ? { status: 'unavailable', now: load.now } : load;
}

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
