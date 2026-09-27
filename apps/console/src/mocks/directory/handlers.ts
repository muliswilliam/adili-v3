/**
 * MSW handlers standing in for the directory's Commission read endpoints (contract draft
 * `packages/schemas/internal/directory.yaml`, spec 01) until the directory implements them (#13).
 * Used by `pnpm dev` with DIRECTORY_MOCK=true (see `src/server.ts`) and by tests. Every caller
 * sees every Commission; visibility is the directory's job and is not faked here.
 */
import { http, HttpResponse } from 'msw';

import { COMMISSION_TYPES, REPORTING_OFFICER_FILTERS } from '../../lib/commission-filters';
import type { Commission, CommissionPage, ProblemDetails } from '../../server/directory/types';
import { MOCK_COMMISSIONS, OFFICER_CATEGORIES } from './fixtures';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TYPES = new Set<string>(COMMISSION_TYPES);
const OFFICER_FILTERS = new Set<string>(REPORTING_OFFICER_FILTERS);

export function problem(
  status: number,
  title: string,
  detail: string,
  extra: Partial<ProblemDetails> = {},
) {
  return HttpResponse.json<ProblemDetails>(
    { type: 'about:blank', title, status, detail, ...extra },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

function matches(item: Commission, query: URLSearchParams): boolean {
  const search = query.get('search')?.trim().toLowerCase();
  const type = query.get('type');
  const officer = query.get('reportingOfficer');
  return (
    (!search || item.name.toLowerCase().includes(search) || item.slug.includes(search)) &&
    (!type || item.type === type) &&
    (!officer || (item.reportingOfficer?.state ?? 'none') === officer)
  );
}

/** The fake directory's handlers, for a directory served at `baseUrl`. */
export function directoryHandlers(baseUrl: string, commissions: Commission[] = MOCK_COMMISSIONS) {
  const url = (path: string) => new URL(path, baseUrl).href;

  return [
    http.get<never, never, CommissionPage | ProblemDetails>(
      url('/v1/commissions'),
      ({ request }) => {
        const query = new URL(request.url).searchParams;
        const errors: ProblemDetails['errors'] = [];
        const type = query.get('type');
        const officer = query.get('reportingOfficer');
        const limit = Number(query.get('limit') ?? DEFAULT_LIMIT);
        // The cursor is opaque to callers; the fake uses the offset of the next row.
        const offset = Number(query.get('cursor') ?? 0);
        if (type && !TYPES.has(type)) errors.push({ path: 'type', message: 'Unknown type.' });
        if (officer && !OFFICER_FILTERS.has(officer)) {
          errors.push({ path: 'reportingOfficer', message: 'Unknown reporting officer state.' });
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
          errors.push({ path: 'limit', message: `Use 1 to ${MAX_LIMIT}.` });
        }
        if (!Number.isInteger(offset) || offset < 0) {
          errors.push({ path: 'cursor', message: 'Unknown cursor.' });
        }
        if (errors.length > 0) {
          return problem(400, 'Bad Request', 'The query is not valid.', { errors });
        }

        const found = commissions.filter((item) => matches(item, query));
        const next = offset + limit;
        return HttpResponse.json<CommissionPage>({
          items: found.slice(offset, next),
          nextCursor: next < found.length ? String(next) : null,
        });
      },
    ),

    http.get<{ slug: string }, never, Commission | ProblemDetails>(
      url('/v1/commissions/:slug'),
      ({ params, request }) => {
        const found = commissions.find((item) => item.slug === params.slug);
        return found
          ? HttpResponse.json<Commission>(found)
          : problem(404, 'Not Found', 'No such Commission.', {
              instance: new URL(request.url).pathname,
            });
      },
    ),

    http.get(url('/v1/reference/officer-categories'), () => HttpResponse.json(OFFICER_CATEGORIES)),
  ];
}
