import { z } from 'zod';

import type { components } from './reporting/api.gen';
import type { ReportingClient } from './reporting/client.server';
import { callService, SERVICE_UNAVAILABLE, type ServiceResult } from './service-call';

/**
 * The reporting service's Commission open-data preview (spec 09b S6, `getCommissionOpenDataPreview`)
 * as the page renders it. Pure: the caller injects the client (`open-data-preview.ts` makes it for
 * the signed-in commission-admin).
 *
 * The contract types the release but leaves each table's rows open (`additionalProperties`); their
 * shape is the release tables' (#491 `services/reporting/src/open-data/tables.ts`), checked here,
 * so a row the page cannot read is a failed load, never a wrong figure.
 */

/** reporting.yaml `OpenDataRelease`. */
export type OpenDataRelease = components['schemas']['OpenDataRelease'];

const count = z.number().int().nonnegative().nullable();
const commission = { commission: z.string(), commissionName: z.string() };

const filingRow = z.object({
  ...commission,
  reportStatus: z.enum(['not-reported', 'submitted-on-time', 'submitted-late']),
  cycle: z.enum(['initial', 'biennial', 'final', 'all']),
  expected: count,
  filed: count,
  nonFilers: count,
  /** filed / expected, to four decimals; null when nothing was expected or not shown. */
  filingRate: z.number().min(0).max(1).nullable(),
  suppressed: z.boolean(),
});

const complianceRow = z.object({
  ...commission,
  determinationsCompliant: count,
  determinationsNonCompliant: count,
  determinationsFurtherAction: count,
  clarificationsIssued: count,
  clarificationsResolved: count,
  actionsNoticeToComply: count,
  actionsWarning: count,
  actionsSalaryStoppage: count,
  actionsDisciplinaryReferral: count,
  referrals: count,
  suppressed: z.boolean(),
});

const accessRequestsRow = z.object({
  ...commission,
  received: count,
  granted: count,
  declined: count,
  suppressed: z.boolean(),
});

const tables = z.object({
  'filing-by-commission': z.array(filingRow),
  'compliance-by-commission': z.array(complianceRow).max(1),
  'access-requests': z.array(accessRequestsRow).max(1),
});

export type FilingRow = z.infer<typeof filingRow>;
export type ComplianceRow = z.infer<typeof complianceRow>;
export type AccessRequestsRow = z.infer<typeof accessRequestsRow>;

/** The release shown and the Commission's own rows of its three Commission tables. */
export interface CommissionOpenDataPreview {
  release: OpenDataRelease;
  /** One row per cycle and the `all` total, as released. */
  filing: FilingRow[];
  /** The Commission's row; null when the release has none for it. */
  compliance: ComplianceRow | null;
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
