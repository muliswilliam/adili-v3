import { COMMISSION_ADMIN, FORM_M_ROLES } from '@adili/roles';

import { json, mockCallerOf, problem } from '../mock-http';
import { currentReleaseOf } from './releases-mock.server';

/**
 * The reporting service's Commission open-data preview (spec 09b S6,
 * `getCommissionOpenDataPreview`), in memory, as one part of the reporting mock
 * (`mock.server.ts`): the current release of the releases mock's store (`releases-mock.server.ts`,
 * so what EACC builds, publishes or withdraws there shows here), its Commission tables filtered
 * to the caller's as the service does. Its rules follow #491: 404 to anyone but the Commission's
 * Form M roles (supervisor, commission-admin, reporting officer), 403 to those but its
 * commission-admin, 404 while no release is built, 503 when object storage is down (the
 * `unavailable` seed of REPORTING_MOCK_RELEASES).
 */

/** The Commission tables the preview returns. */
const COMMISSION_TABLES = [
  'filing-by-commission',
  'compliance-by-commission',
  'access-requests',
] as const;

/** Answers `GET /v1/commissions/{slug}/open-data/preview`; null for any other request. */
export function mockOpenDataFetch(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  const match = /^\/v1\/commissions\/([^/]+)\/open-data\/preview$/.exec(path);
  if (!match || request.method !== 'GET') return null;
  const slug = decodeURIComponent(match[1] ?? '');
  const caller = mockCallerOf(request);
  const formM = caller.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));
  if (caller.tenant !== slug || !formM) return problem(404, 'Not found');
  if (!caller.roles.includes(COMMISSION_ADMIN)) return problem(403, 'Forbidden');
  const shown = currentReleaseOf();
  if (shown === 'unavailable') return problem(503, 'Upstream service unavailable');
  if (!shown) return problem(404, 'Not found');
  return json(200, {
    release: shown.release,
    tables: Object.fromEntries(
      COMMISSION_TABLES.map((table) => [
        table,
        shown.tables[table].rows.filter((row) => row.commission === slug),
      ]),
    ),
  });
}
