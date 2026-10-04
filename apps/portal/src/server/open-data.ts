import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { openDataClient, openDataPublicBase } from './reporting/client.server';
import { loadOpenDataPage, type OpenDataPageResult } from './open-data.server';

/**
 * Server functions of the public Open data page (spec 09b FE-4): no session, no token; the
 * reporting service's public API answers through the portal's cache.
 */

export const releaseSelection = z.object({
  fy: z.number().int().min(2000).max(2100).optional(),
  kind: z.enum(['annual', 'snapshot']).optional(),
  version: z.number().int().min(1).optional(),
});

export const getOpenDataPage = createServerFn({ method: 'GET' })
  .validator(releaseSelection)
  .handler(({ data }): Promise<OpenDataPageResult> => loadOpenDataPage(openDataClient(), data));

/** The public API's base URL, for About this data. */
export const getOpenDataApiBase = createServerFn({ method: 'GET' }).handler(() =>
  openDataPublicBase(),
);
