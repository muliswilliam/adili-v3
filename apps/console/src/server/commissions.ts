import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
import {
  callDirectory,
  type Commission,
  type CommissionPage,
  createDirectoryClient,
  type DirectoryClient,
  type DirectoryResult,
  type OfficerCategory,
} from './directory/client';
import { env } from './env.server';

/** Runs `work` with a directory client acting as the signed-in user. */
async function asViewer<T>(
  work: (client: DirectoryClient) => Promise<DirectoryResult<T>>,
): Promise<DirectoryResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) {
    return { ok: false, error: { kind: 'unauthenticated' } };
  }
  return work(
    createDirectoryClient({
      baseUrl: env().DIRECTORY_API_URL,
      accessToken: session.accessToken,
    }),
  );
}

export const listCommissionsInput = z.object({
  search: z.string().max(100).optional(),
  type: z.enum(['hosted', 'federated']).optional(),
  reportingOfficer: z.enum(['none', 'invited', 'activated']).optional(),
  cursor: z.string().optional(),
});

export type ListCommissionsInput = z.infer<typeof listCommissionsInput>;

/** `GET /v1/commissions`: one page, ordered by name, with the number of matches. */
export const listCommissions = createServerFn({ method: 'GET' })
  .validator(listCommissionsInput)
  .handler(({ data }): Promise<DirectoryResult<CommissionPage>> =>
    asViewer((client) =>
      callDirectory(() => client.GET('/v1/commissions', { params: { query: data } })),
    ),
  );

/** `GET /v1/commissions/{slug}`: 404 problem when missing or not visible to the viewer. */
export const getCommission = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string().min(1).max(40) }))
  .handler(({ data }): Promise<DirectoryResult<Commission>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}', { params: { path: { slug: data.slug } } }),
      ),
    ),
  );

/** `GET /v1/reference/officer-categories`: the statutory list in stable order. */
export const listOfficerCategories = createServerFn({ method: 'GET' }).handler(
  (): Promise<DirectoryResult<OfficerCategory[]>> =>
    asViewer((client) => callDirectory(() => client.GET('/v1/reference/officer-categories'))),
);
