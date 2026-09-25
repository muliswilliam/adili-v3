import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { commissionFiltersSchema } from '../components/commissions/filters';
import { getBff } from './bff.server';
import { type DirectoryClient, directoryClient } from './directory/client.server';
import { callDirectory, type DirectoryResult } from './directory/result';
import type { Commission, CommissionPage, OfficerCategory } from './directory/types';

/** Page size for the Commissions list; "Load more" fetches the next page. */
export const COMMISSIONS_PAGE_SIZE = 50;

async function withDirectory<T>(
  run: (client: DirectoryClient) => Promise<DirectoryResult<T>>,
): Promise<DirectoryResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, failure: { kind: 'unauthenticated' } };
  return run(directoryClient(session.accessToken));
}

/** `GET /v1/commissions`: one page, ordered by name. */
export const listCommissions = createServerFn({ method: 'GET' })
  .validator(commissionFiltersSchema.extend({ cursor: z.string().optional() }))
  .handler(({ data }): Promise<DirectoryResult<CommissionPage>> =>
    withDirectory((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions', {
          params: { query: { ...data, limit: COMMISSIONS_PAGE_SIZE } },
        }),
      ),
    ),
  );

/** `GET /v1/commissions/{slug}`: not-found also covers Commissions the caller cannot see. */
export const getCommission = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(({ data }): Promise<DirectoryResult<Commission>> =>
    withDirectory((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}', { params: { path: { slug: data.slug } } }),
      ),
    ),
  );

/** `GET /v1/reference/officer-categories`: the 19 statutory categories in stable order. */
export const listOfficerCategories = createServerFn({ method: 'GET' }).handler(
  (): Promise<DirectoryResult<OfficerCategory[]>> =>
    withDirectory((client) => callDirectory(() => client.GET('/v1/reference/officer-categories'))),
);
