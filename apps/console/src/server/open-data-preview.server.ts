import { z } from 'zod';

import {
  type AccessRequestsRow,
  type ComplianceByCommissionRow,
  type FilingByCommissionRow,
  OPEN_DATA_ROW_SCHEMAS,
} from './open-data-tables';
import type { ReportingClient } from './reporting/client.server';
import type { OpenDataRelease } from './reporting/types';
import { callService, SERVICE_UNAVAILABLE, type ServiceResult } from './service-call';

/**
 * The reporting service's Commission open-data preview (spec 09b S6, `getCommissionOpenDataPreview`)
 * as the page renders it. Pure: the caller injects the client (`open-data-preview.ts` makes it for
 * the signed-in commission-admin).
 *
 * The contract types the release but leaves each table's rows open (`additionalProperties`); they
 * are checked against the release tables' rows (`open-data-tables.ts`), so a row the page cannot
 * read is a failed load, never a wrong figure.
 */

const tables = z.object({
  'filing-by-commission': z.array(OPEN_DATA_ROW_SCHEMAS['filing-by-commission']),
  'compliance-by-commission': z.array(OPEN_DATA_ROW_SCHEMAS['compliance-by-commission']).max(1),
  'access-requests': z.array(OPEN_DATA_ROW_SCHEMAS['access-requests']).max(1),
});

/** The release shown and the Commission's own rows of its three Commission tables. */
export interface CommissionOpenDataPreview {
  release: OpenDataRelease;
  /** One row per cycle and the `all` total, as released. */
  filing: FilingByCommissionRow[];
  /** The Commission's row; null when the release has none for it. */
  compliance: ComplianceByCommissionRow | null;
  accessRequests: AccessRequestsRow | null;
}

/**
 * `GET /v1/commissions/{slug}/open-data/preview`. 404 is both "not of the Commission" and "no
 * release built yet"; the page asks only for the viewer's own Commission as its admin, so there it
 * means the latter. 403 is the Commission's other staff; 503 object storage down (unavailable).
 */
export async function loadCommissionOpenDataPreview(
  client: ReportingClient,
  slug: string,
): Promise<ServiceResult<CommissionOpenDataPreview>> {
  const result = await callService(() =>
    client.GET('/v1/commissions/{slug}/open-data/preview', { params: { path: { slug } } }),
  );
  if (!result.ok) return result;
  const parsed = tables.safeParse(result.data.tables);
  if (!parsed.success) return SERVICE_UNAVAILABLE;
  return {
    ok: true,
    data: {
      release: result.data.release,
      filing: parsed.data['filing-by-commission'],
      compliance: parsed.data['compliance-by-commission'][0] ?? null,
      accessRequests: parsed.data['access-requests'][0] ?? null,
    },
  };
}
