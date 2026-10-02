import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asViewer } from './as-viewer.server';
import type { DirectoryResult, LeaOfficerAccount } from './directory/client';
import {
  type AgencyOfficers,
  type AgencyRow,
  loadAgencies,
  loadAgencyOfficers,
  provisionOfficer,
  revokeOfficer,
} from './lea-accounts.server';

/**
 * Server functions of Platform settings, law enforcement accounts (spec 10 FE-6), called as the
 * signed-in platform administrator. The directory allows platform admins only.
 */

const agencyCode = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/);

export const getLeaAgencies = createServerFn({ method: 'GET' }).handler(
  (): Promise<DirectoryResult<AgencyRow[]>> => asViewer((client) => loadAgencies(client)),
);

export const getAgencyOfficers = createServerFn({ method: 'GET' })
  .validator(z.object({ code: agencyCode }))
  .handler(({ data }): Promise<DirectoryResult<AgencyOfficers>> =>
    asViewer((client) => loadAgencyOfficers(client, data.code)),
  );

export const provisionLeaOfficer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      code: agencyCode,
      /** One per dialog submission, reused on retry. */
      idempotencyKey: z.uuid(),
      // Loose bounds only: the directory validates and its 400 problem maps back to the dialog.
      officer: z.object({
        name: z.string().max(500),
        email: z.string().max(500),
        phone: z.string().max(40),
      }),
    }),
  )
  .handler(({ data }): Promise<DirectoryResult<LeaOfficerAccount>> =>
    asViewer((client) => provisionOfficer(client, data.code, data.officer, data.idempotencyKey)),
  );

export const revokeLeaOfficer = createServerFn({ method: 'POST' })
  .validator(z.object({ officerId: z.uuid() }))
  .handler(({ data }): Promise<DirectoryResult<LeaOfficerAccount>> =>
    asViewer((client) => revokeOfficer(client, data.officerId)),
  );
