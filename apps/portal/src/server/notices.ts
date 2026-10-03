import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asDeclarant as asDeclarantOf } from './bff.server';
import {
  loadMyNotices,
  type MyNoticesResult,
  type NoticeRespondResult,
  respondToNotice,
} from './notices.server';
import type { Unauthenticated } from './results';
import { reviewClient, type ReviewClient } from './review/client.server';

/** Server functions for the declarant's notices (spec 08 FE-7). Tokens stay on the server. */

function asDeclarant<T>(call: (client: ReviewClient) => Promise<T>) {
  return asDeclarantOf(reviewClient, call);
}

/** The notices, and the server's clock so "days left" reads the same on server and browser. */
export type MyNoticesLoad = (MyNoticesResult | Unauthenticated) & { now: string };

export const getMyNotices = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyNoticesLoad> => ({
    ...(await asDeclarant(loadMyNotices)),
    now: new Date().toISOString(),
  }),
);

export const respondToMyNotice = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      actionId: z.uuid(),
      /** One per form, reused on retry. */
      idempotencyKey: z.uuid(),
      text: z.string().trim().min(1).max(4000),
      attachments: z.array(z.uuid()).max(10),
    }),
  )
  .handler(({ data }): Promise<NoticeRespondResult | Unauthenticated> =>
    asDeclarant((client) =>
      respondToNotice(client, data.actionId, data.text, data.attachments, data.idempotencyKey),
    ),
  );
