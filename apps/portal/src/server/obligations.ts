import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import { declarationsClient } from './declarations/client.server';
import {
  loadMyObligations,
  loadObligation,
  type MyObligationsResult,
  type ObligationDetailResult,
} from './obligations.server';

/** The signed-in declarant's obligations. Runs on the server; tokens never leave it. */
export const getMyObligations = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyObligationsResult> => {
    const session = await getBff().getSession(getRequest());
    if (!session) return { status: 'not-declarant' };
    return loadMyObligations(declarationsClient(session.accessToken));
  },
);

/** One of the signed-in declarant's obligations with its reminder history. */
export const getObligationDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }): Promise<ObligationDetailResult> => {
    const session = await getBff().getSession(getRequest());
    if (!session) return { status: 'not-found' };
    return loadObligation(declarationsClient(session.accessToken), data.id);
  });
