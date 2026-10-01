import { createServerFn } from '@tanstack/react-start';

import { type HistoryResult, loadHistory } from './access-history.server';
import { listNotices, type NoticesResult } from './access-notices.server';
import { accessClient } from './access/client.server';
import { asDeclarant } from './bff.server';
import type { Unauthenticated } from './results';

/**
 * "Who accessed my declaration" (spec 10 FE-4, S12): the declarant's history, with the requests
 * it is about (their purpose, scope, the declarant's response and the decision live on the
 * notices, which the drawer shows) and the server's clock, so whether a window is open reads the
 * same on server and browser.
 */
export type HistoryLoad =
  { status: 'ok'; history: HistoryResult; notices: NoticesResult; now: string } | Unauthenticated;

export const getMyAccessHistory = createServerFn({ method: 'GET' }).handler(
  (): Promise<HistoryLoad> =>
    asDeclarant(accessClient, async (client) => {
      const [history, notices] = await Promise.all([loadHistory(client), listNotices(client)]);
      return { status: 'ok' as const, history, notices, now: new Date().toISOString() };
    }),
);
