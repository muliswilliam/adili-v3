/**
 * The national consolidated report part of the reporting mock (`mock.server.ts` hands it every
 * `/v1/eacc/national-reports/` request): an in-memory stand-in for reporting.yaml's
 * `getNationalReport`, `buildNationalReport`, `updateNationalReportNarrative` and
 * `approveNationalReport`, used when REPORTING_MOCK is set. The aggregates are built from the
 * intake mock's Commissions and receipts (`mockEaccIntake`), so the intake and the national
 * report count the same reports. It follows the service's rules
 * (`services/reporting/src/national-reports`):
 *
 * - EACC analysts and supervisors of tenant `eacc` only (403 for anyone else); approving is a
 *   supervisor's.
 * - The first build makes the caller the author; every build and narrative save adds the caller to
 *   the contributors, and none of them may approve (403 `separation-of-duties`).
 * - A rebuild recomputes the aggregates from the receipts as they are and keeps the narrative;
 *   saving maps each section's text onto the stored paragraphs, so an unchanged paragraph keeps its
 *   id and labels and an edited one stops being an AI draft.
 * - Approval allocates `NCR-EACC-<FY end>-<seq>-<check>`; the PDF follows `pdfDelayMs` later
 *   (four seconds by default), as the approval workflow issues it. A retry with the same
 *   Idempotency-Key replays the approval; another one is 409 `ncr-approved`.
 *
 * REPORTING_MOCK_NCR picks where FY 2025/2026's report starts: `not-built`; `draft`, built by
 * another analyst (Brian Otieno) from every report received, with an overview and two findings,
 * the second an AI draft; `stale`, that draft built before the latest report came in; `approved`,
 * approved by Esther Chebet with its PDF. The receipts carry no clarification or access-request
 * counts, so those totals are 0. A narrative save with `offline` in its text answers 503, so the
 * editor's retry shows. `mockNcrDocumentsFetch` answers documents' download of the NCR PDF, with
 * links to `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`).
 */
import { EACC_SUPERVISOR } from '@adili/roles';
import { NARRATIVE_MAX_LENGTH } from '@adili/ui';
import createClient from 'openapi-fetch';

import type { paths as documentsPaths } from '../documents/api.gen';
import { type Env, envSchema } from '../env.server';
import { isRecord, json, mockCallerOf, problem, readJson, unsignedMockToken } from '../mock-http';
import { isCandidatesPath, mockCandidatesFetch } from './candidates-mock.server';
import { isEacc, mockEaccIntake, mockHasBiennialCycle } from './eacc-mock.server';
import {
  type CommissionAggregate,
  type Intake,
  NARRATIVE_SECTION_IDS,
  type NarrativeDraft,
  type NarrativeParagraph,
  type NarrativeSectionId,
  type NationalAggregates,
  type NationalReport,
  type Officer,
  type SectionAggregate,
} from './types';

export type NcrMockSeed = Env['REPORTING_MOCK_NCR'];

type Row = Intake['commissions'][number];
type SectionKey = 'initial' | 'biennial' | 'final';
const SECTIONS: readonly SectionKey[] = ['initial', 'biennial', 'final'];

/** The year of the seeded report. */
const SEEDED_FY = 2025;

/** A report as the mock keeps it; `narrative-draft-mock.server.ts` drafts into it. */
export interface StoredReport {
  id: string;
  fy: number;
  version: number;
  status: 'draft' | 'approved';
  builtAt: string;
  aggregates: NationalAggregates;
  reportsIncluded: number;
  paragraphs: NarrativeParagraph[];
  author: Officer;
  contributors: string[];
  approver: Officer | null;
  approvedAt: string | null;
  reference: string | null;
  /** The PDF, once issued: at `pdfReadyAt`. */
  documentId: string | null;
  pdfReadyAt: number | null;
  /** The latest AI narrative draft (spec 09b), null until one is asked for. */
  narrativeDraft: NarrativeDraft | null;
  /** A draft still being written: `settle` inserts or discards it once `readyAt` has passed. */
  pendingDraft: { readyAt: number; settle: () => void } | null;
}

interface Store {
  reports: Map<number, StoredReport>;
  /** Approvals by year, caller and Idempotency-Key, for replays. */
  approvals: Map<string, Response>;
  sequence: number;
  pdfDelayMs: number;
}

let store: Store | null = null;

const BRIAN: Officer = { subject: 'mock-brian-otieno', name: 'Brian Otieno' };
const ESTHER: Officer = { subject: 'mock-esther-chebet', name: 'Esther Chebet' };

const DRAFT_OVERVIEW =
  'This report consolidates the compliance reports (Form M) received from Responsible Commissions for the financial year 1 July 2025 to 30 June 2026 under Regulation 25(2) of the Conflict of Interest Regulations, 2026.';
const DRAFT_FINDINGS = [
  'Eleven of fifteen Commissions reported, three of them late. The national declared rate is high, driven by the National Police Service Commission and the Teachers Service Commission.',
  'The Nairobi City County Public Service Board reports a biennial rate of 62%, well below every other Commission.',
];

export function paragraph(
  section: NarrativeSectionId,
  position: number,
  text: string,
  extra: Partial<NarrativeParagraph> = {},
): NarrativeParagraph {
  return {
    id: crypto.randomUUID(),
    section,
    position,
    text,
    aiDraft: false,
    aggregateRefs: [],
    candidateIds: [],
    ...extra,
  };
}

/** The year's receipts: the intake's Commissions that have reported. */
function receiptsOf(fy: number): Row[] {
  return mockEaccIntake(fy).commissions.filter((row) => row.status !== 'not-reported');
}

/** Starts the store over at `seed`; `pdfDelayMs` is how long an approval's PDF takes. */
export function resetNcrMock(
  seed: NcrMockSeed,
  { pdfDelayMs = 4000 }: { pdfDelayMs?: number } = {},
): void {
  store = { reports: new Map(), approvals: new Map(), sequence: 0, pdfDelayMs };
  if (seed === 'not-built') return;
  const fy = SEEDED_FY;
  const receipts = receiptsOf(fy);
  // `stale`: built before the latest report came in.
  const latest = [...receipts].sort((a, b) =>
    (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''),
  )[0];
  const included = seed === 'stale' ? receipts.filter((row) => row !== latest) : receipts;
  const report: StoredReport = {
    id: '0199b100-0000-7000-8000-000000000001',
    fy,
    version: 3,
    status: 'draft',
    builtAt: '2026-09-24T07:15:00Z',
    aggregates: buildAggregates(fy, included),
    reportsIncluded: included.length,
    paragraphs: [
      paragraph('overview', 0, DRAFT_OVERVIEW),
      paragraph('findings', 0, DRAFT_FINDINGS[0] ?? ''),
      paragraph('findings', 1, DRAFT_FINDINGS[1] ?? '', {
        aiDraft: true,
        aggregateRefs: ['commission.cpsb047.biennialFilingRate'],
      }),
    ],
    author: BRIAN,
    contributors: [BRIAN.subject],
    approver: null,
    approvedAt: null,
    reference: null,
    documentId: null,
    pdfReadyAt: null,
    narrativeDraft: null,
    pendingDraft: null,
  };
  store.reports.set(fy, report);
  if (seed === 'approved') {
    store.sequence = 1;
    report.paragraphs.push(
      paragraph(
        'recommendations',
        0,
        'Commissions that did not report should do so within 30 days.',
      ),
    );
    Object.assign(report, {
      status: 'approved',
      version: 4,
      approver: ESTHER,
      approvedAt: '2026-09-25T13:40:00Z',
      reference: referenceOf(fy, 1),
      documentId: '0199b200-0000-7000-8000-000000000001',
      pdfReadyAt: 0,
    } satisfies Partial<StoredReport>);
  }
}

function ensureSeeded(): Store {
  if (!store) resetNcrMock(seedFromEnv());
  if (!store) throw new Error('The national report mock did not seed');
  return store;
}

function seedFromEnv(): NcrMockSeed {
  return envSchema.shape.REPORTING_MOCK_NCR.catch('not-built').parse(
    process.env.REPORTING_MOCK_NCR,
  );
}

/** NCR references as the numbering package allocates them (ISO 7064 MOD 37-36 check). */
function referenceOf(fy: number, seq: number): string {
  const body = `NCR-EACC-${String(fy + 1)}-${String(seq).padStart(7, '0')}`;
  return `${body}-${checkCharacter(body)}`;
}

function checkCharacter(input: string): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const modulus = alphabet.length;
  let state = modulus / 2;
  for (const char of input.replace(/-/g, '')) {
    state = ((((state || modulus) * 2) % (modulus + 1)) + alphabet.indexOf(char)) % modulus;
  }
  return alphabet.charAt((modulus + 1 - (((state || modulus) * 2) % (modulus + 1))) % modulus);
}

function rateOf(declared: number, expected: number): number | null {
  return expected > 0 ? Math.round((declared / expected) * 10_000) / 10_000 : null;
}

interface Counts {
  expected: number;
  declared: number;
}

function section(counts: Counts): SectionAggregate {
  return {
    expected: counts.expected,
    declared: counts.declared,
    notDeclared: Math.max(0, counts.expected - counts.declared),
    rate: rateOf(counts.declared, counts.expected),
  };
}

const add = (a: Counts, b: Counts): Counts => ({
  expected: a.expected + b.expected,
  declared: a.declared + b.declared,
});

const countsOf = (row: Row, key: SectionKey): Counts => ({
  expected: row.rates[key]?.expected ?? 0,
  declared: row.rates[key]?.declared ?? 0,
});

/**
 * As the service's `buildAggregates`: every Commission of the intake, with the numbers of those
 * among `receipts`.
 */
function buildAggregates(fy: number, receipts: readonly Row[]): NationalAggregates {
  const included = new Set(receipts.map((row) => row.commission.slug));
  const totals: Record<SectionKey, Counts> = {
    initial: { expected: 0, declared: 0 },
    biennial: { expected: 0, declared: 0 },
    final: { expected: 0, declared: 0 },
  };
  const byCommission: Record<string, CommissionAggregate> = {};
  const rows = [...mockEaccIntake(fy).commissions].sort((a, b) =>
    a.commission.slug.localeCompare(b.commission.slug),
  );
  let late = 0;
  for (const row of rows) {
    const { slug, name } = row.commission;
    if (!included.has(slug)) {
      byCommission[slug] = {
        name,
        status: 'not-reported',
        reportId: null,
        reference: null,
        submittedAt: null,
        initial: null,
        biennial: null,
        final: null,
        clarifications: null,
        accessRequests: null,
      };
      continue;
    }
    for (const key of SECTIONS) totals[key] = add(totals[key], countsOf(row, key));
    if (row.status === 'submitted-late') late += 1;
    byCommission[slug] = {
      name,
      status: row.status,
      reportId: row.reportId,
      reference: row.reference,
      submittedAt: row.submittedAt,
      initial: section(countsOf(row, 'initial')),
      biennial: {
        ...section(countsOf(row, 'biennial')),
        noCycleInPeriod: !mockHasBiennialCycle(fy),
      },
      final: section(countsOf(row, 'final')),
      clarifications: 0,
      accessRequests: { received: 0, granted: 0, declined: 0 },
    };
  }
  const reported = included.size;
  return {
    fy,
    reporting: {
      commissions: rows.length,
      reported,
      onTime: reported - late,
      late,
      notReported: rows.length - reported,
      rate: rateOf(reported, rows.length),
    },
    national: {
      initial: section(totals.initial),
      biennial: section(totals.biennial),
      final: section(totals.final),
      all: section(add(add(totals.initial, totals.biennial), totals.final)),
      clarifications: 0,
      accessRequests: { received: 0, granted: 0, declined: 0 },
    },
    byCommission,
  };
}

/** The report as the service answers it, a draft whose job has ended inserted or discarded. */
export function viewOf(report: StoredReport): NationalReport {
  if (report.pendingDraft && Date.now() >= report.pendingDraft.readyAt) {
    const { settle } = report.pendingDraft;
    report.pendingDraft = null;
    settle();
  }
  if (report.pdfReadyAt !== null && report.documentId === null && Date.now() >= report.pdfReadyAt) {
    report.documentId = crypto.randomUUID();
  }
  const paragraphs = [...report.paragraphs].sort(
    (a, b) =>
      NARRATIVE_SECTION_IDS.indexOf(a.section) - NARRATIVE_SECTION_IDS.indexOf(b.section) ||
      a.position - b.position,
  );
  const narrative = Object.fromEntries(
    NARRATIVE_SECTION_IDS.map((id) => [
      id,
      paragraphs
        .filter((each) => each.section === id)
        .map((each) => each.text)
        .join('\n\n'),
    ]),
  ) as NationalReport['narrative'];
  return {
    id: report.id,
    fy: report.fy,
    version: report.version,
    status: report.status,
    builtAt: report.builtAt,
    reportsIncluded: report.reportsIncluded,
    aggregates: report.aggregates,
    narrative,
    narrativeParagraphs: paragraphs.map((each) => ({ ...each })),
    author: report.author,
    approver: report.approver,
    approvedAt: report.approvedAt,
    reference: report.reference,
    documentId: report.documentId,
    narrativeDraft: report.narrativeDraft ? { ...report.narrativeDraft } : null,
  };
}

/** As the service's `saveSection`: unchanged text keeps its paragraph, an edit keeps the id. */
function saveSection(
  id: NarrativeSectionId,
  existing: readonly NarrativeParagraph[],
  text: string,
): NarrativeParagraph[] {
  const stored = existing
    .filter((each) => each.section === id)
    .sort((a, b) => a.position - b.position);
  const texts = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((each) => each.trim())
    .filter((each) => each !== '');
  const used = new Set<string>();
  const kept = texts.map((each) => {
    const same = stored.find((candidate) => !used.has(candidate.id) && candidate.text === each);
    if (same) used.add(same.id);
    return same;
  });
  return texts.map((each, position) => {
    const same = kept[position];
    if (same) return { ...same, position };
    const atPosition = stored[position];
    if (atPosition && !used.has(atPosition.id)) {
      used.add(atPosition.id);
      return { ...atPosition, position, text: each, aiDraft: false };
    }
    return paragraph(id, position, each);
  });
}

const NOT_BUILT = 'The national consolidated report for the year has not been built yet.';

/** The year's report as stored, for the narrative draft part of the mock; undefined before it is built. */
export function ncrMockReport(fy: number): StoredReport | undefined {
  return ensureSeeded().reports.get(fy);
}

export const approvedConflict = () =>
  problem(409, 'The report is approved and can no longer change.', 'ncr-approved');

/** Answers `/v1/eacc/national-reports/{fy}[/build|/narrative|/approve]` from the store. */
export async function mockNcrFetch(request: Request): Promise<Response> {
  const data = ensureSeeded();
  const url = new URL(request.url);
  // The year's pattern candidates (#331), from the report as last built.
  if (isCandidatesPath(url.pathname)) {
    return mockCandidatesFetch(request, (fy) => data.reports.get(fy)?.aggregates ?? null);
  }
  const caller = mockCallerOf(request);
  if (!isEacc(caller)) {
    return problem(
      403,
      'Only EACC analysts and supervisors work on the national consolidated report.',
    );
  }
  const officer: Officer = {
    subject: caller.subject ?? 'unknown',
    name: caller.name ?? caller.subject ?? 'unknown',
  };
  const match = /^\/v1\/eacc\/national-reports\/(\d{4})(?:\/(build|narrative|approve))?$/.exec(
    url.pathname,
  );
  if (!match) return problem(404, 'Not found');
  const fy = Number(match[1]);
  const action = match[2];
  const report = data.reports.get(fy);

  if (request.method === 'GET' && !action) {
    return report ? json(200, viewOf(report)) : problem(404, NOT_BUILT);
  }

  if (request.method === 'POST' && action === 'build') {
    const receipts = receiptsOf(fy);
    if (receipts.length === 0) {
      return problem(
        409,
        'No Commission has submitted its report for the year yet.',
        'no-submitted-reports',
      );
    }
    if (report?.status === 'approved') return approvedConflict();
    await delay(900);
    const next: StoredReport = report ?? {
      id: crypto.randomUUID(),
      fy,
      version: 0,
      status: 'draft',
      builtAt: '',
      aggregates: buildAggregates(fy, receipts),
      reportsIncluded: 0,
      paragraphs: [],
      author: officer,
      contributors: [],
      approver: null,
      approvedAt: null,
      reference: null,
      documentId: null,
      pdfReadyAt: null,
      narrativeDraft: null,
      pendingDraft: null,
    };
    Object.assign(next, {
      builtAt: new Date().toISOString(),
      aggregates: buildAggregates(fy, receipts),
      reportsIncluded: receipts.length,
    });
    touch(next, officer);
    data.reports.set(fy, next);
    return json(200, viewOf(next));
  }

  if (request.method === 'PATCH' && action === 'narrative') {
    if (!report) return problem(404, NOT_BUILT);
    if (report.status === 'approved') return approvedConflict();
    const body = await readJson(request);
    const errors = narrativeErrors(body);
    if (errors.length > 0 || !isRecord(body)) {
      return json(400, { type: 'about:blank', title: 'Bad Request', status: 400, errors });
    }
    const texts = body as Record<NarrativeSectionId, string>;
    if (NARRATIVE_SECTION_IDS.some((id) => texts[id].includes('offline'))) {
      return problem(503, 'The reporting service is unavailable');
    }
    report.paragraphs = NARRATIVE_SECTION_IDS.flatMap((id) =>
      saveSection(id, report.paragraphs, texts[id]),
    );
    touch(report, officer);
    return json(200, viewOf(report));
  }

  if (request.method === 'POST' && action === 'approve') {
    if (!caller.roles.includes(EACC_SUPERVISOR)) {
      return problem(403, 'Only an EACC supervisor can approve the national consolidated report.');
    }
    const key = request.headers.get('idempotency-key');
    if (!key) return problem(400, 'Idempotency-Key missing');
    const replayKey = `${String(fy)}:${officer.subject}:${key}`;
    const replay = data.approvals.get(replayKey);
    if (replay) return replay.clone();
    if (!report) return problem(404, NOT_BUILT);
    if (report.status === 'approved') return approvedConflict();
    if (
      report.author.subject === officer.subject ||
      report.contributors.includes(officer.subject)
    ) {
      return problem(
        403,
        'The author cannot approve: another EACC supervisor approves the report.',
        'separation-of-duties',
      );
    }
    await delay(700);
    data.sequence += 1;
    Object.assign(report, {
      status: 'approved',
      version: report.version + 1,
      approver: officer,
      approvedAt: new Date().toISOString(),
      reference: referenceOf(fy, data.sequence),
      pdfReadyAt: Date.now() + data.pdfDelayMs,
    } satisfies Partial<StoredReport>);
    const response = json(200, viewOf(report));
    data.approvals.set(replayKey, response.clone());
    return response;
  }

  return problem(405, 'Method not allowed');
}

/** A build, narrative save or inserted draft: a new version, with the caller a contributor. */
export function touch(report: StoredReport, officer: Officer): void {
  report.version += 1;
  if (!report.contributors.includes(officer.subject)) report.contributors.push(officer.subject);
}

function narrativeErrors(body: unknown): { path: string; message: string }[] {
  if (!isRecord(body)) return [{ path: '', message: 'Must be an object' }];
  const errors: { path: string; message: string }[] = [];
  for (const id of NARRATIVE_SECTION_IDS) {
    const text = body[id];
    if (typeof text !== 'string') errors.push({ path: id, message: 'Required' });
    else if (text.length > NARRATIVE_MAX_LENGTH[id]) {
      errors.push({ path: id, message: `At most ${String(NARRATIVE_MAX_LENGTH[id])} characters` });
    }
  }
  return errors;
}

/** Answers documents' download of an approved NCR's PDF, for EACC analysts and supervisors. */
export function mockNcrDocumentsFetch(request: Request): Promise<Response> {
  const data = ensureSeeded();
  const match = /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(request.url).pathname);
  const known = [...data.reports.values()].some((report) => report.documentId === match?.[1]);
  if (request.method !== 'GET' || !match?.[1] || !isEacc(mockCallerOf(request)) || !known) {
    return Promise.resolve(problem(404, 'Not found'));
  }
  return Promise.resolve(
    json(200, {
      downloadUrl: `/api/mock-files/${match[1]}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      sha256: '0'.repeat(64),
    }),
  );
}

/** The title of a mock file this mock links to, or null: the NCR PDF of an approved report. */
export function mockNcrFileTitle(id: string): string | null {
  const report = [...ensureSeeded().reports.values()].find((each) => each.documentId === id);
  return report?.reference ? `${report.reference}.pdf` : null;
}

function delay(ms: number): Promise<void> {
  return process.env.VITEST ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/** A documents client answered by this mock, as an EACC officer holding `roles`, for tests. */
export function mockNcrDocumentsClient(roles: readonly string[]) {
  const token = unsignedMockToken({
    subject: 'mock-eacc',
    name: 'EACC officer',
    roles,
    tenant: 'eacc',
  });
  return createClient<documentsPaths>({
    baseUrl: 'http://documents.test',
    headers: { authorization: `Bearer ${token}` },
    fetch: mockNcrDocumentsFetch,
  });
}
