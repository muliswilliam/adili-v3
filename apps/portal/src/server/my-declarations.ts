import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { PAGE_SIZES } from '../declaration/my-declarations';
import { asDeclarant } from './bff.server';
import { declarationsClient } from './declarations/client.server';
import {
  loadMyDeclarations,
  loadVersions,
  type MyDeclarationsPage,
  type VersionsResult,
} from './my-declarations.server';
import type { Unauthenticated, Unavailable } from './results';

/**
 * "My declarations" (spec 06 FE-4): the page, and a declaration's versions when its row
 * expands. Amend and discard amendment are with the workspace's server functions
 * (`declarations.ts`). Tokens stay on the server.
 */

export const getMyDeclarationsPage = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      page: z.number().int().min(1),
      pageSize: z.literal(PAGE_SIZES),
    }),
  )
  .handler(({ data }): Promise<MyDeclarationsPage | Unavailable | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => loadMyDeclarations(client, data)),
  );

export const getMyDeclarationVersions = createServerFn({ method: 'GET' })
  .validator(z.object({ declarationId: z.uuid() }))
  .handler(({ data }): Promise<VersionsResult | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => loadVersions(client, data.declarationId)),
  );
