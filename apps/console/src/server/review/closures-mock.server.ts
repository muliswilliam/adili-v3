/**
 * In-memory stand-in for the review service's bulk closure endpoints (review.yaml, spec 08 #203),
 * part of the review mock (`mock.server.ts`, REVIEW_MOCK). Seeded relative to "now", one cycle
 * per state of the bulk closure screen (#202):
 *
 * - The current year (`MOCK_CLOSURE_CYCLES.ready`): swept today at 02:00 (Nairobi), its window
 *   closed a month ago. 1,240 system `compliant-no-issues` proposals wait (7 in 10 biennial, 2
 *   initial, 1 final; a quarter in each of `MOCK_CLOSURE_ENTITIES`), 25 cases were sampled for
 *   review and 312 closures are already approved. `MOCK_CLOSURE_FORMER_HOLDER` once held 3 of
 *   the waiting cases, so their bulk approval skips those.
 * - The year before (`pending`): no sweep yet, its window closes in 90 days.
 * - Two years before (`closed`): every proposal approved (980), nothing left.
 *
 * One store for every Commission (the console reads the caller's own). As review.yaml has it: supervisors only (403 `supervisor-required` for anyone else, read from
 * the token's realm roles); approval needs an Idempotency-Key and runs in chunks of 100, each
 * allocating its CMP numbers in sequence, `chunkDelayMs` apart so a summary read meanwhile sees
 * the chunks land. With `failAtChunk` (REVIEW_MOCK_CLOSURES_FAIL_AT_CHUNK) the first attempt of
 * every key stops with a 503 before that chunk; sent again with the key it resumes, and the
 * result counts every closure approved under the key.
 */
import { SUPERVISOR } from '@adili/roles';
import { addDays, nairobiDayStartOf } from '@adili/ui';

import { json, type MockCaller, problem } from '../mock-http';
import type { components } from './api.gen';

type Schemas = components['schemas'];
type DeclarationType = 'initial' | 'biennial' | 'final';

export const MOCK_CLOSURE_CHUNK = 100;

/** The reporting entities the seeded proposals belong to, a quarter each. */
export const MOCK_CLOSURE_ENTITIES = [
  'e7a1ee00-0000-4000-8000-000000000001',
  'e7a1ee00-0000-4000-8000-000000000002',
  'e7a1ee00-0000-4000-8000-000000000003',
  'e7a1ee00-0000-4000-8000-000000000004',
] as const;

/** A supervisor who once held three of the waiting cases, as their reviewer. */
export const MOCK_CLOSURE_FORMER_HOLDER = 'a1b2c3d4-0000-4000-8000-0000000000f1';

/** The cycle years of each state, for "now" in 2026. Recomputed by `resetClosuresMock`. */
export const MOCK_CLOSURE_CYCLES = { ready: 2026, pending: 2025, closed: 2024 };

export interface ClosuresMockOptions {
  /** Pause between chunks, so progress can be watched; 0 in tests. */
  chunkDelayMs?: number;
  /** The first attempt of each key stops before this chunk (1-based) with a 503. */
  failAtChunk?: number;
}

interface Proposal {
  cycleYear: number;
  type: DeclarationType;
  reportingEntityId: string;
  /** Officers who held the case: the separation rule skips them. */
  heldBy: string[];
  status: 'proposed' | 'approved';
  reference: string | null;
  /** The bulk approval (approver and key) that approved it. */
  approval: string | null;
}

interface Cycle {
  sampled: number;
  windowClosedAt: string;
  lastSweptAt: string | null;
}

const proposals: Proposal[] = [];
const cycles = new Map<number, Cycle>();
/** Chunks approved per bulk approval (approver and key). */
const approvals = new Map<string, number>();
/** Bulk approvals whose first attempt already failed (`failAtChunk`). */
const failedOnce = new Set<string>();
/** The last CMP sequence number per Commission and year. */
const sequences = new Map<string, number>();
let options: Required<ClosuresMockOptions> = { chunkDelayMs: 0, failAtChunk: 0 };

const TYPES: readonly DeclarationType[] = [
  'biennial',
  'biennial',
  'biennial',
  'biennial',
  'biennial',
  'biennial',
  'biennial',
  'initial',
  'initial',
  'final',
];

function seed(cycleYear: number, count: number, status: Proposal['status']) {
  for (let i = 0; i < count; i++) {
    proposals.push({
      cycleYear,
      type: TYPES[i % TYPES.length] ?? 'biennial',
      reportingEntityId: MOCK_CLOSURE_ENTITIES[i % MOCK_CLOSURE_ENTITIES.length] ?? '',
      heldBy: [],
      status,
      reference: null,
      approval: null,
    });
  }
}

/** Seeds the cycles with "now" at `now`. */
export function resetClosuresMock(now: number, next: ClosuresMockOptions = {}) {
  proposals.length = 0;
  cycles.clear();
  approvals.clear();
  failedOnce.clear();
  sequences.clear();
  options = { chunkDelayMs: next.chunkDelayMs ?? 300, failAtChunk: next.failAtChunk ?? 0 };
  const iso = new Date(now).toISOString();
  const year = new Date(now).getUTCFullYear();
  Object.assign(MOCK_CLOSURE_CYCLES, { ready: year, pending: year - 1, closed: year - 2 });
  const sweptAt = new Date(Date.parse(nairobiDayStartOf(iso)) + 2 * 3_600_000).toISOString();

  cycles.set(year, {
    sampled: 25,
    windowClosedAt: nairobiDayStartOf(addDays(iso, -31)),
    lastSweptAt: sweptAt,
  });
  seed(year, 312, 'approved');
  for (const each of proposals) each.reference = nextReference('tsc', iso);
  seed(year, 1240, 'proposed');
  proposals
    .filter((each) => each.status === 'proposed')
    .slice(5, 8)
    .forEach((each) => each.heldBy.push(MOCK_CLOSURE_FORMER_HOLDER));

  cycles.set(year - 1, {
    sampled: 0,
    windowClosedAt: nairobiDayStartOf(addDays(iso, 90)),
    lastSweptAt: null,
  });

  cycles.set(year - 2, {
    sampled: 20,
    windowClosedAt: nairobiDayStartOf(addDays(iso, -400)),
    lastSweptAt: addDays(sweptAt, -365),
  });
  seed(year - 2, 980, 'approved');
}

/** The next CMP reference of the Commission for the year of `at`, gapless. */
function nextReference(slug: string, at: string): string {
  const year = at.slice(0, 4);
  const key = `${slug}:${year}`;
  const n = (sequences.get(key) ?? 0) + 1;
  sequences.set(key, n);
  const check = '0123456789ACDEFHJKLMNPRTUVWXY'[n % 29] ?? 'K';
  return `CMP-${slug.toUpperCase()}-${year}-${String(n).padStart(7, '0')}-${check}`;
}

interface Filter {
  cycleYear: number;
  type: DeclarationType | null;
  reportingEntityId: string | null;
}

function filterOf(url: URL): Filter | null {
  const cycleYear = Number(url.searchParams.get('cycleYear'));
  if (!Number.isInteger(cycleYear) || cycleYear < 2000 || cycleYear > 2100) return null;
  const type = url.searchParams.get('type');
  if (type !== null && !['initial', 'biennial', 'final'].includes(type)) return null;
  return {
    cycleYear,
    type: type as DeclarationType | null,
    reportingEntityId: url.searchParams.get('reportingEntityId'),
  };
}

function matches(filter: Filter) {
  return (each: Proposal) =>
    each.cycleYear === filter.cycleYear &&
    (filter.type === null || each.type === filter.type) &&
    (filter.reportingEntityId === null || each.reportingEntityId === filter.reportingEntityId);
}

function summary(filter: Filter): Schemas['ClosureSummary'] {
  const matching = proposals.filter(matches(filter));
  const cycle = cycles.get(filter.cycleYear);
  // The sample spreads over types and entities as the proposals do.
  const all = proposals.filter((each) => each.cycleYear === filter.cycleYear).length;
  const sampled =
    cycle && all > 0 ? Math.round((cycle.sampled * matching.length) / all) : (cycle?.sampled ?? 0);
  return {
    cycleYear: filter.cycleYear,
    eligibleProposed: matching.filter((each) => each.status === 'proposed').length,
    sampled,
    approved: matching.filter((each) => each.status === 'approved').length,
    sampleRate: 0.02,
    windowClosedAt: cycle?.windowClosedAt ?? null,
    lastSweptAt: cycle?.lastSweptAt ?? null,
  };
}

const pause = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

async function approve(
  slug: string,
  filter: Filter,
  caller: string,
  key: string,
): Promise<Response> {
  const approval = `${caller}:${key}`;
  const waiting = () =>
    proposals.filter(
      (each) =>
        matches(filter)(each) && each.status === 'proposed' && !each.heldBy.includes(caller),
    );
  let chunksThisRequest = 0;
  for (;;) {
    const chunk = waiting().slice(0, MOCK_CLOSURE_CHUNK);
    if (chunk.length === 0) break;
    chunksThisRequest += 1;
    const done = approvals.get(approval) ?? 0;
    if (options.failAtChunk > 0 && !failedOnce.has(approval) && done + 1 >= options.failAtChunk) {
      failedOnce.add(approval);
      return problem(503, 'The numbering service did not respond');
    }
    if (chunksThisRequest > 1) await pause(options.chunkDelayMs);
    const at = new Date().toISOString();
    for (const each of chunk) {
      each.status = 'approved';
      each.reference = nextReference(slug, at);
      each.approval = approval;
    }
    approvals.set(approval, done + 1);
  }
  const mine = proposals.filter((each) => each.approval === approval);
  return json(200, {
    approved: mine.length,
    skipped: proposals.filter(
      (each) => matches(filter)(each) && each.status === 'proposed' && each.heldBy.includes(caller),
    ).length,
    firstReference: mine.at(0)?.reference ?? null,
    lastReference: mine.at(-1)?.reference ?? null,
    chunks: approvals.get(approval) ?? 0,
  } satisfies Schemas['BulkApprovalResult']);
}

/** The bulk closure endpoints; null for any other request. */
export async function closuresRoute(
  request: Request,
  caller: MockCaller,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = /^\/v1\/commissions\/([a-z][a-z0-9]{1,19})\/closures$/.exec(url.pathname);
  const slug = path?.[1];
  if (!slug || (request.method !== 'GET' && request.method !== 'POST')) return null;
  if (!caller.roles.includes(SUPERVISOR)) {
    return problem(403, 'Bulk closure is for supervisors', 'supervisor-required');
  }
  const filter = filterOf(url);
  if (!filter) return problem(400, 'Query failed validation');
  if (request.method === 'GET') return json(200, summary(filter));
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  return approve(slug, filter, caller.subject ?? 'unknown', key);
}
