/**
 * In-memory stand-in for the reporting service's EACC endpoints the national consolidated report
 * needs (reporting.yaml: `getEaccIntake` for the year's totals, `getNationalReport`,
 * `buildNationalReport`, `updateNationalReportNarrative`, `approveNationalReport`), used when
 * REPORTING_MOCK is set, for screens without the reporting service and its upstreams (directory,
 * documents, Temporal) running. It follows the service's rules
 * (`services/reporting/src/national-reports`):
 *
 * - EACC analysts and supervisors only (403 for anyone else); approving is a supervisor's.
 * - The first build makes the caller the author; every build and narrative save adds the caller to
 *   the contributors, and none of them may approve (403 `separation-of-duties`).
 * - A rebuild recomputes the aggregates from the Commissions' receipts and keeps the narrative;
 *   saving maps each section's text onto the stored paragraphs, so an unchanged paragraph keeps its
 *   id and labels and an edited one stops being an AI draft.
 * - Approval allocates `NCR-EACC-<FY end>-<seq>-<check>`; the PDF follows `pdfDelayMs` later
 *   (four seconds by default), as the approval workflow issues it. A retry with the same
 *   Idempotency-Key replays the approval; another one is 409 `ncr-approved`.
 *
 * One store for every caller. FY 2025/2026: 14 active Commissions, 11 reported (3 late). FY
 * 2026/2027, the current year, nobody has reported for yet. REPORTING_MOCK_NCR picks where FY
 * 2025/2026's report starts: `not-built`; `draft`, built by another analyst (Brian Otieno) with
 * an overview and two findings, the second an AI draft; `stale`, that draft with the Kwale board's
 * late report received since the build; `approved`, approved by Esther Chebet with its PDF.
 *
 * A narrative save with `offline` in its text answers 503, so the editor's retry shows. Also
 * answers the documents service's download of the NCR PDF (`mockReportingDocumentsFetch`), with
 * links to `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`).
 */
import createClient from 'openapi-fetch';

import type { paths as documentsPaths } from '../documents/api.gen';
import { isRecord, json, mockCallerOf, problem, readJson, unsignedMockToken } from '../mock-http';
import type { paths } from './api.gen';
import {
  type CommissionAggregate,
  type Intake,
  NARRATIVE_SECTION_IDS,
  type NarrativeParagraph,
  type NarrativeSectionId,
  type NationalAggregates,
  type NationalReport,
  type Officer,
  type SectionAggregate,
} from './types';

export type ReportingMockSeed = 'not-built' | 'draft' | 'stale' | 'approved';

const EACC_ANALYST = 'eacc-analyst';
const EACC_SUPERVISOR = 'eacc-supervisor';

const MAX_LENGTH: Record<NarrativeSectionId, number> = {
  overview: 20_000,
  findings: 40_000,
  recommendations: 20_000,
};

interface Counts {
  expected: number;
  declared: number;
}

/** A Commission's Form M as EACC received it: the counts the aggregates are built from. */
interface Receipt {
  reportId: string;
  reference: string;
  submittedAt: string;
  late: boolean;
  initial: Counts;
  biennial: Counts;
  final: Counts;
  clarifications: number;
}

interface MockCommission {
  slug: string;
  name: string;
  issuer: string;
}

const COMMISSIONS: MockCommission[] = [
  { slug: 'tsc', name: 'Teachers Service Commission', issuer: 'TSC' },
  { slug: 'psc', name: 'Public Service Commission', issuer: 'PSC' },
  { slug: 'parlsc', name: 'Parliamentary Service Commission', issuer: 'PARLSC' },
  { slug: 'npsc', name: 'National Police Service Commission', issuer: 'NPSC' },
  { slug: 'jsc', name: 'Judicial Service Commission', issuer: 'JSC' },
  { slug: 'cpsbnairobicity', name: 'Nairobi City County Public Service Board', issuer: 'NRB' },
  { slug: 'cpsbmombasa', name: 'Mombasa County Public Service Board', issuer: 'MSA' },
  { slug: 'cpsbnakuru', name: 'Nakuru County Public Service Board', issuer: 'NKR' },
  { slug: 'cpsbkiambu', name: 'Kiambu County Public Service Board', issuer: 'KBU' },
  { slug: 'cpsbmachakos', name: 'Machakos County Public Service Board', issuer: 'MKS' },
  { slug: 'cpsbuasingishu', name: 'Uasin Gishu County Public Service Board', issuer: 'UGU' },
  { slug: 'cpsbkwale', name: 'Kwale County Public Service Board', issuer: 'KWL' },
  { slug: 'cpsbmandera', name: 'Mandera County Public Service Board', issuer: 'MDR' },
  { slug: 'cpsbturkana', name: 'Turkana County Public Service Board', issuer: 'TRK' },
];

const c = (expected: number, declared: number): Counts => ({ expected, declared });

/** FY 2025/2026's receipts (due 31 July 2026), keyed by Commission slug. */
function receipts2025(): Map<string, Receipt> {
  const receipt = (
    slug: string,
    seq: number,
    submittedAt: string,
    initial: Counts,
    biennial: Counts,
    final: Counts,
    clarifications: number,
  ): [string, Receipt] => {
    const issuer = COMMISSIONS.find((each) => each.slug === slug)?.issuer ?? slug.toUpperCase();
    return [
      slug,
      {
        reportId: `0199b000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
        reference: `RPT-${issuer}-2026-${String(seq).padStart(7, '0')}-K`,
        submittedAt,
        late: submittedAt > '2026-07-31T20:59:59Z',
        initial,
        biennial,
        final,
        clarifications,
      },
    ];
  };
  return new Map([
    receipt(
      'tsc',
      1,
      '2026-08-06T09:12:00Z',
      c(9412, 8960),
      c(331_870, 318_402),
      c(7905, 6811),
      412,
    ),
    receipt('psc', 1, '2026-07-21T10:40:00Z', c(214, 206), c(2890, 2811), c(96, 90), 18),
    receipt('parlsc', 1, '2026-07-28T08:05:00Z', c(96, 94), c(1200, 1188), c(40, 39), 4),
    receipt(
      'npsc',
      1,
      '2026-07-30T14:22:00Z',
      c(6120, 5988),
      c(104_300, 101_120),
      c(2410, 2209),
      97,
    ),
    receipt('jsc', 1, '2026-07-17T07:58:00Z', c(1180, 1152), c(6400, 6211), c(210, 198), 11),
    receipt(
      'cpsbnairobicity',
      1,
      '2026-08-12T11:30:00Z',
      c(1840, 1702),
      c(16_240, 10_069),
      c(410, 351),
      64,
    ),
    receipt('cpsbmombasa', 1, '2026-07-24T12:00:00Z', c(620, 598), c(7410, 7102), c(0, 3), 9),
    receipt('cpsbnakuru', 1, '2026-07-29T09:45:00Z', c(512, 501), c(6802, 6590), c(133, 127), 7),
    receipt('cpsbkiambu', 1, '2026-07-31T16:10:00Z', c(455, 440), c(6120, 5890), c(148, 101), 12),
    receipt('cpsbmachakos', 1, '2026-08-03T08:20:00Z', c(388, 371), c(5210, 4988), c(0, 0), 5),
    receipt(
      'cpsbuasingishu',
      1,
      '2026-07-27T13:35:00Z',
      c(402, 390),
      c(5980, 5801),
      c(121, 116),
      6,
    ),
  ]);
}

/** The Kwale board's late report, received after the `stale` seed's build. */
function kwaleReceipt(): Receipt {
  return {
    reportId: '0199b000-0000-7000-8000-000000000099',
    reference: 'RPT-KWL-2026-0000001-K',
    submittedAt: '2026-09-29T10:05:00Z',
    late: true,
    initial: c(254, 244),
    biennial: c(2822, 2764),
    final: c(66, 60),
    clarifications: 3,
  };
}

interface StoredReport {
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
}

interface Store {
  receipts: Map<number, Map<string, Receipt>>;
  reports: Map<number, StoredReport>;
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
  'Eleven of fourteen Commissions reported, three of them late. The national declared rate is high, driven by the Teachers Service Commission and the National Police Service Commission.',
  'The Nairobi City County Public Service Board reports a biennial rate of 62%, well below every other Commission.',
];

function paragraph(
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

/** Starts the store over at `seed`; `pdfDelayMs` is how long an approval's PDF takes. */
export function resetReportingMock(
  seed: ReportingMockSeed,
  { pdfDelayMs = 4000 }: { pdfDelayMs?: number } = {},
): void {
  const receipts = receipts2025();
  store = {
    receipts: new Map([
      [2025, receipts],
      [2026, new Map<string, Receipt>()],
    ]),
    reports: new Map(),
    approvals: new Map(),
    sequence: 0,
    pdfDelayMs,
  };
  if (seed === 'not-built') return;
  const report: StoredReport = {
    id: '0199b100-0000-7000-8000-000000000001',
    fy: 2025,
    version: 3,
    status: 'draft',
    builtAt: '2026-09-24T07:15:00Z',
    aggregates: buildAggregates(2025, receipts),
    reportsIncluded: receipts.size,
    paragraphs: [
      paragraph('overview', 0, DRAFT_OVERVIEW),
      paragraph('findings', 0, DRAFT_FINDINGS[0] ?? ''),
      paragraph('findings', 1, DRAFT_FINDINGS[1] ?? '', {
        aiDraft: true,
        aggregateRefs: ['commission.cpsbnairobicity.rate.biennial'],
      }),
    ],
    author: BRIAN,
    contributors: [BRIAN.subject],
    approver: null,
    approvedAt: null,
    reference: null,
    documentId: null,
    pdfReadyAt: null,
  };
  store.reports.set(2025, report);
  if (seed === 'stale') receipts.set('cpsbkwale', kwaleReceipt());
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
      reference: referenceOf(2025, 1),
      documentId: '0199b200-0000-7000-8000-000000000001',
      pdfReadyAt: 0,
    } satisfies Partial<StoredReport>);
  }
}

function ensureSeeded(): Store {
  if (!store) resetReportingMock(seedFromEnv());
  if (!store) throw new Error('The reporting mock did not seed');
  return store;
}

function seedFromEnv(): ReportingMockSeed {
  const seed = process.env.REPORTING_MOCK_NCR;
  return seed === 'draft' || seed === 'stale' || seed === 'approved' ? seed : 'not-built';
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

function section(counts: Counts): SectionAggregate {
  return {
    expected: counts.expected,
    declared: counts.declared,
    notDeclared: Math.max(0, counts.expected - counts.declared),
    rate: rateOf(counts.declared, counts.expected),
  };
}

function add(total: Counts, counts: Counts): Counts {
  return { expected: total.expected + counts.expected, declared: total.declared + counts.declared };
}

/** As the service's `buildAggregates`: per section and Commission, from the receipts. */
function buildAggregates(fy: number, receipts: Map<string, Receipt>): NationalAggregates {
  let initial = c(0, 0);
  let biennial = c(0, 0);
  let final = c(0, 0);
  let clarifications = 0;
  const byCommission: Record<string, CommissionAggregate> = {};
  for (const commission of [...COMMISSIONS].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const receipt = receipts.get(commission.slug);
    if (!receipt) {
      byCommission[commission.slug] = {
        name: commission.name,
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
    initial = add(initial, receipt.initial);
    biennial = add(biennial, receipt.biennial);
    final = add(final, receipt.final);
    clarifications += receipt.clarifications;
    byCommission[commission.slug] = {
      name: commission.name,
      status: receipt.late ? 'submitted-late' : 'submitted-on-time',
      reportId: receipt.reportId,
      reference: receipt.reference,
      submittedAt: receipt.submittedAt,
      initial: section(receipt.initial),
      biennial: { ...section(receipt.biennial), noCycleInPeriod: false },
      final: section(receipt.final),
      clarifications: receipt.clarifications,
      accessRequests: { received: 0, granted: 0, declined: 0 },
    };
  }
  const late = [...receipts.values()].filter((receipt) => receipt.late).length;
  const reported = receipts.size;
  return {
    fy,
    reporting: {
      commissions: COMMISSIONS.length,
      reported,
      onTime: reported - late,
      late,
      notReported: COMMISSIONS.length - reported,
      rate: rateOf(reported, COMMISSIONS.length),
    },
    national: {
      initial: section(initial),
      biennial: section(biennial),
      final: section(final),
      all: section(add(add(initial, biennial), final)),
      clarifications,
      accessRequests: { received: 0, granted: 0, declined: 0 },
    },
    byCommission,
  };
}

function intakeOf(fy: number, receipts: Map<string, Receipt>): Intake {
  const commissions = [...COMMISSIONS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((commission) => {
      const receipt = receipts.get(commission.slug);
      const rates = receipt
        ? Object.fromEntries(
            (['initial', 'biennial', 'final'] as const).map((key) => [
              key,
              { ...receipt[key], rate: rateOf(receipt[key].declared, receipt[key].expected) },
            ]),
          )
        : {};
      return {
        commission: { slug: commission.slug, name: commission.name },
        status: receipt
          ? receipt.late
            ? ('submitted-late' as const)
            : ('submitted-on-time' as const)
          : ('not-reported' as const),
        reportId: receipt?.reportId ?? null,
        reference: receipt?.reference ?? null,
        submittedAt: receipt?.submittedAt ?? null,
        rates,
        outliers: [],
        chases: { count: 0, lastAt: null },
        formMDocumentId: null,
        receiptDocumentId: null,
      };
    });
  const totals = buildAggregates(fy, receipts);
  return {
    fy,
    totals: {
      onTime: totals.reporting.onTime,
      late: totals.reporting.late,
      notReported: totals.reporting.notReported,
      nationalDeclaredRate: totals.national.all.rate,
    },
    commissions,
  };
}

function viewOf(report: StoredReport): NationalReport {
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

function forbidden(detail: string, code?: string) {
  return json(403, {
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    detail,
    ...(code ? { code } : {}),
  });
}

function conflict(code: string, detail: string) {
  return json(409, { type: 'about:blank', title: 'Conflict', status: 409, detail, code });
}

const NOT_BUILT = 'The national consolidated report for the year has not been built yet.';

/** Answers the reporting client's requests as the service would, from the store. */
export async function mockReportingFetch(request: Request): Promise<Response> {
  const data = ensureSeeded();
  const url = new URL(request.url);
  const caller = mockCallerOf(request);
  const eacc = caller.roles.includes(EACC_ANALYST) || caller.roles.includes(EACC_SUPERVISOR);
  if (!eacc) {
    return forbidden(
      'Only EACC analysts and supervisors work on the national consolidated report.',
    );
  }
  const officer: Officer = {
    subject: caller.subject ?? 'unknown',
    name: caller.name ?? caller.subject ?? 'unknown',
  };

  if (request.method === 'GET' && url.pathname === '/v1/eacc/compliance-reports') {
    const fy = Number(url.searchParams.get('fy'));
    const receipts = data.receipts.get(fy);
    if (!receipts) return problem(400, 'No reports exist for that year');
    return json(200, intakeOf(fy, receipts));
  }

  const match = /^\/v1\/eacc\/national-reports\/(\d{4})(?:\/(build|narrative|approve))?$/.exec(
    url.pathname,
  );
  if (!match) return problem(404, 'Not found');
  const fy = Number(match[1]);
  const action = match[2];
  const receipts = data.receipts.get(fy);
  if (!receipts) return problem(404, NOT_BUILT);
  const report = data.reports.get(fy);

  if (request.method === 'GET' && !action) {
    return report ? json(200, viewOf(report)) : problem(404, NOT_BUILT);
  }

  if (request.method === 'POST' && action === 'build') {
    if (receipts.size === 0) {
      return conflict(
        'no-submitted-reports',
        'No Commission has submitted its report for the year yet.',
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
    };
    Object.assign(next, {
      builtAt: new Date().toISOString(),
      aggregates: buildAggregates(fy, receipts),
      reportsIncluded: receipts.size,
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
      return forbidden('Only an EACC supervisor can approve the national consolidated report.');
    }
    const key = request.headers.get('idempotency-key');
    if (!key) return problem(400, 'Idempotency-Key missing');
    const replay = data.approvals.get(key);
    if (replay) return replay.clone();
    if (!report) return problem(404, NOT_BUILT);
    if (report.status === 'approved') return approvedConflict();
    if (
      report.author.subject === officer.subject ||
      report.contributors.includes(officer.subject)
    ) {
      return forbidden(
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
    data.approvals.set(key, response.clone());
    return response;
  }

  return problem(405, 'Method not allowed');
}

function approvedConflict() {
  return conflict('ncr-approved', 'The report is approved and can no longer change.');
}

function touch(report: StoredReport, officer: Officer): void {
  report.version += 1;
  if (!report.contributors.includes(officer.subject)) report.contributors.push(officer.subject);
}

function narrativeErrors(body: unknown): { path: string; message: string }[] {
  if (!isRecord(body)) return [{ path: '', message: 'Must be an object' }];
  const errors: { path: string; message: string }[] = [];
  for (const id of NARRATIVE_SECTION_IDS) {
    const text = body[id];
    if (typeof text !== 'string') errors.push({ path: id, message: 'Required' });
    else if (text.length > MAX_LENGTH[id]) {
      errors.push({ path: id, message: `At most ${String(MAX_LENGTH[id])} characters` });
    }
  }
  return errors;
}

/** Answers the documents service's download of an approved NCR's PDF, for EACC roles. */
export function mockReportingDocumentsFetch(request: Request): Promise<Response> {
  const data = ensureSeeded();
  const match = /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(request.url).pathname);
  const caller = mockCallerOf(request);
  const eacc = caller.roles.includes(EACC_ANALYST) || caller.roles.includes(EACC_SUPERVISOR);
  const known = [...data.reports.values()].some((report) => report.documentId === match?.[1]);
  if (request.method !== 'GET' || !match?.[1] || !eacc || !known) {
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
export function mockReportingFileTitle(id: string): string | null {
  const report = [...ensureSeeded().reports.values()].find((each) => each.documentId === id);
  return report?.reference ? `${report.reference}.pdf` : null;
}

function delay(ms: number): Promise<void> {
  return process.env.VITEST ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function mockToken(name: string, roles: readonly string[]): string {
  return unsignedMockToken({
    subject: `user-${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    roles,
  });
}

/** A reporting client answered by this mock, as `name` holding `roles`, for tests. */
export function mockReportingClient(name: string, roles: readonly string[]) {
  return createClient<paths>({
    baseUrl: 'http://reporting.test',
    headers: { authorization: `Bearer ${mockToken(name, roles)}` },
    fetch: mockReportingFetch,
  });
}

/** A documents client answered by this mock, as an EACC officer holding `roles`, for tests. */
export function mockReportingDocumentsClient(roles: readonly string[]) {
  return createClient<documentsPaths>({
    baseUrl: 'http://documents.test',
    headers: { authorization: `Bearer ${mockToken('EACC officer', roles)}` },
    fetch: mockReportingDocumentsFetch,
  });
}
