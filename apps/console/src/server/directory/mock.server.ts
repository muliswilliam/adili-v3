/**
 * In-memory stand-in for the directory's Commission endpoints (contract draft, spec 01), used
 * when DIRECTORY_MOCK is set until the directory implements them (#13). It answers every caller
 * as if they could see every Commission; visibility rules are the directory's job.
 */
import type { Commission, OfficerCategory, ReportingOfficer } from './types';

export const OFFICER_CATEGORIES: OfficerCategory[] = [
  {
    code: 'act-s32-2',
    citation: 'Act s.32(2)',
    description:
      'Cabinet, MPs, DPP, Secretary to the Cabinet, JSC members, Chapter Fifteen commissioners, senior EACC staff',
  },
  { code: 'act-s32-3', citation: 'Act s.32(3)', description: 'Senators' },
  {
    code: 'act-s32-4',
    citation: 'Act s.32(4)',
    description: 'County executive committees, MCAs and County Public Service Board members',
  },
  {
    code: 'act-s32-5',
    citation: 'Act s.32(5)',
    description:
      'Principal secretaries, envoys, officers under PSC control and state corporation staff',
  },
  {
    code: 'act-s32-6',
    citation: 'Act s.32(6)',
    description: 'Officers under a County Public Service Board and county corporation staff',
  },
  {
    code: 'act-s32-7',
    citation: 'Act s.32(7)',
    description: 'Judges, magistrates and officers under JSC disciplinary control',
  },
  {
    code: 'act-s32-8',
    citation: 'Act s.32(8)',
    description: 'Officers under Parliamentary Service Commission disciplinary control',
  },
  {
    code: 'act-s32-9',
    citation: 'Act s.32(9)',
    description: 'Officers under a County Assembly Service Board',
  },
  { code: 'act-s32-10', citation: 'Act s.32(10)', description: 'Registered teachers' },
  {
    code: 'act-s32-11',
    citation: 'Act s.32(11)',
    description: 'Members of the Kenya Defence Forces',
  },
  {
    code: 'act-s32-12',
    citation: 'Act s.32(12)',
    description: 'Members of the National Intelligence Service',
  },
  {
    code: 'act-s32-13',
    citation: 'Act s.32(13)',
    description: 'Members of the National Police Service',
  },
  {
    code: 'act-s32-14',
    citation: 'Act s.32(14)',
    description: 'Members of the Witness Protection Agency',
  },
  {
    code: 'regs-r5-a',
    citation: 'Regs r.5(a)',
    description: 'EACC staff below the rank of Deputy Director',
  },
  {
    code: 'regs-r5-b',
    citation: 'Regs r.5(b)',
    description: 'Officers and employees of public universities',
  },
  {
    code: 'regs-r5-c',
    citation: 'Regs r.5(c)',
    description: 'Central Bank staff and state-corporation banks',
  },
  {
    code: 'regs-r5-d',
    citation: 'Regs r.5(d)',
    description: 'Employees of Article 248(2) constitutional commissions',
  },
  {
    code: 'regs-r5-e',
    citation: 'Regs r.5(e)',
    description: 'Employees of the ODPP, Controller of Budget and Auditor General',
  },
  {
    code: 'regs-r5-f',
    citation: 'Regs r.5(f)',
    description: 'Officers of reporting entities not otherwise assigned',
  },
];

function categories(...codes: OfficerCategory['code'][]): OfficerCategory[] {
  return OFFICER_CATEGORIES.filter((category) => codes.includes(category.code));
}

function officer(
  name: string,
  email: string,
  state: 'invited' | 'activated',
  invitedAt: string,
): ReportingOfficer {
  return {
    id: crypto.randomUUID(),
    name,
    email,
    phone: '+254712345678',
    state,
    invitedAt,
    activatedAt: state === 'activated' ? invitedAt.replace('T09', 'T15') : null,
  };
}

function commission(
  slug: string,
  name: string,
  type: Commission['type'],
  categoryCodes: OfficerCategory['code'][],
  reportingOfficer: ReportingOfficer | null,
  createdAt: string,
): Commission {
  return {
    id: crypto.randomUUID(),
    slug,
    issuerCode: slug.toUpperCase(),
    name,
    type,
    categories: categories(...categoryCodes),
    status: 'active',
    policyVersion: 1,
    reportingOfficer,
    roster: {
      status: 'none',
      expectedDeclarants: 0,
      onboardedDeclarants: 0,
      flagged: 0,
      lastImportAt: null,
      lastImportId: null,
    },
    createdAt,
  };
}

/** Ordered by name, as the directory returns them. */
export const MOCK_COMMISSIONS: Commission[] = [
  commission(
    'cue',
    'Commission for University Education',
    'federated',
    ['regs-r5-b'],
    null,
    '2026-09-18T08:10:00Z',
  ),
  commission(
    'eacc',
    'Ethics and Anti-Corruption Commission',
    'hosted',
    ['act-s32-2', 'regs-r5-a'],
    officer('Amina Wanjiru', 'amina.wanjiru@eacc.go.ke', 'invited', '2026-09-22T09:30:00Z'),
    '2026-09-01T07:00:00Z',
  ),
  commission(
    'jsc',
    'Judicial Service Commission',
    'hosted',
    ['act-s32-7'],
    null,
    '2026-09-15T11:45:00Z',
  ),
  commission(
    'npsc',
    'National Police Service Commission',
    'hosted',
    ['act-s32-13'],
    officer('Peter Otieno', 'p.otieno@npsc.go.ke', 'invited', '2026-09-24T09:05:00Z'),
    '2026-09-12T10:20:00Z',
  ),
  commission(
    'psc',
    'Public Service Commission',
    'hosted',
    ['act-s32-5', 'regs-r5-e', 'regs-r5-f'],
    officer('Grace Muthoni', 'grace.muthoni@psc.go.ke', 'activated', '2026-09-03T09:00:00Z'),
    '2026-09-01T07:05:00Z',
  ),
  commission(
    'tsc',
    'Teachers Service Commission',
    'hosted',
    ['act-s32-10'],
    officer('John Kamau', 'john.kamau@tsc.go.ke', 'activated', '2026-09-10T09:15:00Z'),
    '2026-09-08T13:30:00Z',
  ),
];

const DEFAULT_LIMIT = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  });
}

function notFound(instance: string): Response {
  return json(
    { type: 'about:blank', title: 'Not Found', status: 404, detail: 'No such resource.', instance },
    404,
  );
}

function listCommissions(params: URLSearchParams): Response {
  const search = params.get('search')?.trim().toLowerCase();
  const type = params.get('type');
  const reportingOfficer = params.get('reportingOfficer');
  const matches = MOCK_COMMISSIONS.filter(
    (item) =>
      (!search || item.name.toLowerCase().includes(search) || item.slug.includes(search)) &&
      (!type || item.type === type) &&
      (!reportingOfficer || (item.reportingOfficer?.state ?? 'none') === reportingOfficer),
  );
  const offset = Number(params.get('cursor') ?? 0);
  const limit = Number(params.get('limit') ?? DEFAULT_LIMIT);
  const items = matches.slice(offset, offset + limit);
  const next = offset + limit;
  return json({ items, nextCursor: next < matches.length ? String(next) : null });
}

/** A `fetch` that answers the Commission read endpoints from fixtures. */
export function mockDirectoryFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== 'GET') return Promise.resolve(notFound(path));
  if (path === '/v1/commissions') return Promise.resolve(listCommissions(url.searchParams));
  if (path === '/v1/reference/officer-categories') return Promise.resolve(json(OFFICER_CATEGORIES));
  const slug = /^\/v1\/commissions\/([^/]+)$/.exec(path)?.[1];
  const found = slug ? MOCK_COMMISSIONS.find((item) => item.slug === slug) : undefined;
  return Promise.resolve(found ? json(found) : notFound(path));
}
