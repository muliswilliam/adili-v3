import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  listNotices,
  loadNotice,
  type NoticeResult,
  type NoticesResult,
  saveRepresentations,
  type SaveResult,
} from './access-notices.server';
import { accessClient, type AccessClient } from './access/client.server';
import { asDeclarant as asDeclarantOf } from './bff.server';
import type { Unauthenticated } from './results';

/**
 * Server functions for the access requests about the declarant's declaration (spec 10 FE-4).
 * Each carries the server's clock, so the window countdown reads the same on server and browser.
 */

function asDeclarant<T>(call: (client: AccessClient) => Promise<T>) {
  return asDeclarantOf(accessClient, call);
}

export type NoticesLoad = (NoticesResult | Unauthenticated) & { now: string };
export type NoticeLoad = (NoticeResult | Unauthenticated) & { now: string };

export const getMyAccessNotices = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NoticesLoad> => ({
    ...(await asDeclarant(listNotices)),
    now: new Date().toISOString(),
  }),
);

export const getMyAccessNotice = createServerFn({ method: 'GET' })
  .validator(z.object({ requestId: z.uuid() }))
  .handler(async ({ data }): Promise<NoticeLoad> => ({
    ...(await asDeclarant((client) => loadNotice(client, data.requestId))),
    now: new Date().toISOString(),
  }));

export const submitMyRepresentations = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      requestId: z.uuid(),
      idempotencyKey: z.uuid(),
      stance: z.enum(['object', 'consent', 'context']),
      text: z.string().max(8000),
      attachments: z.array(z.uuid()).max(10),
    }),
  )
  .handler(({ data }): Promise<SaveResult | Unauthenticated> =>
    asDeclarant((client) =>
      saveRepresentations(
        client,
        data.requestId,
        { stance: data.stance, text: data.text, attachments: data.attachments },
        data.idempotencyKey,
      ),
    ),
  );
