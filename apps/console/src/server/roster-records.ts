import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { RECORD_STATES, rosterRecordsQuery } from '../components/roster/records-query';
import { commissionSlug } from './commission-slug';
import { asViewer } from './as-viewer.server';
import {
  callDirectory,
  type DirectoryResult,
  type RosterRecord,
  type RosterRecordPage,
} from './directory/client';

/**
 * The Commission whose roster to read: the session's tenant on roster routes, the path's slug on
 * a Commission's pages (platform admins, EACC).
 */

export const listRosterRecordsInput = z.object({
  slug: commissionSlug,
  search: z.string().max(200).optional(),
  state: z.enum(RECORD_STATES).optional(),
  flagged: z.literal(true).optional(),
  identityMismatch: z.literal(true).optional(),
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * `GET /v1/commissions/{slug}/roster/records`: one page ordered by full name, national IDs
 * masked. 403 for EACC staff (counts only, no personal data); 404 for another Commission.
 */
export const listRosterRecords = createServerFn({ method: 'GET' })
  .validator(listRosterRecordsInput)
  .handler(({ data }): Promise<DirectoryResult<RosterRecordPage>> => {
    const { slug: commission, cursor, limit, ...filters } = data;
    return asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/records', {
          params: {
            path: { slug: commission },
            query: rosterRecordsQuery(filters, { cursor, limit }),
          },
        }),
      ),
    );
  });

/**
 * `GET /v1/commissions/{slug}/roster/records/{recordId}`: every field (the national ID in full,
 * so the directory audits the read) and the imports that touched the record.
 */
export const getRosterRecord = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, recordId: z.uuid() }))
  .handler(({ data }): Promise<DirectoryResult<RosterRecord>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/records/{recordId}', {
          params: { path: { slug: data.slug, recordId: data.recordId } },
        }),
      ),
    ),
  );
