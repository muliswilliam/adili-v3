/**
 * The AI narrative draft part of the reporting mock (`mock.server.ts` hands it
 * `POST /v1/eacc/national-reports/{fy}/narrative/draft`, reporting.yaml
 * `draftNationalReportNarrative`, spec 09b S2 and S3): drafts into the national report mock's
 * stored report (`ncr-mock.server.ts`) as the reporting service does with the ai-gateway's
 * `narrate-compliance-report` task. The "task" here writes from the year's figures and the
 * candidates mock's pattern candidates only, every paragraph citing the keys of the figures it
 * states:
 *
 * - overview: Commissions reported and late, declarations made and the national filing rate;
 * - findings: one paragraph per kind of candidate, citing the candidate;
 * - recommendations: follow up the Commissions that did not report; an improvement plan for those
 *   above the non-filer threshold.
 *
 * It follows the service's rules: EACC analysts and supervisors only (403), 404 before the first
 * build, 409 `ncr-approved` once approved, 409 `no-pattern-candidates` for findings (or all) with
 * none to narrate. In each section drafted the new paragraphs replace those still marked as AI
 * drafts, where the first of them stood; `replaceAll` replaces the whole section. The requester
 * becomes a contributor and an inserted draft raises the version. A retry with the same
 * Idempotency-Key reads the same job and inserts it once; another body under that key is 422.
 * A draft ending after a rebuild is discarded (`aggregates-rebuilt`), after the approval
 * (`ncr-approved`).
 *
 * REPORTING_MOCK_NARRATIVE (or `resetNarrativeDraftMock`) picks how the job goes: `inserted`
 * within the request (200); `slow`, 202 and inserted when the report is read `readyAfterMs` later
 * (five seconds by default); `validation` 409 `narrative-validation`, nothing inserted;
 * `slow-validation` 202, then discarded with reason `validation`; `failed` 502
 * `narrative-draft-failed` (reason `provider`); `unavailable` 503.
 */
import { formatNumber, formatPercent } from '@adili/ui';

import { type Env, envSchema } from '../env.server';
import { isRecord, json, mockCallerOf, problem, readJson } from '../mock-http';
import { nationalFigures } from './aggregate-keys';
import { mockCandidatesOf } from './candidates-mock.server';
import { isEacc } from './eacc-mock.server';
import {
  approvedConflict,
  ncrMockReport,
  paragraph,
  type StoredReport,
  touch,
  viewOf,
} from './ncr-mock.server';
import {
  NARRATIVE_SECTION_IDS,
  type NarrativeDraft,
  type NarrativeDraftSection,
  type NarrativeParagraph,
  type NarrativeSectionId,
  type NationalAggregates,
  type Officer,
  type PatternCandidate,
  sectionsDrafted,
} from './types';

export type NarrativeDraftMockSeed = Env['REPORTING_MOCK_NARRATIVE'];

interface Options {
  /** How long a `slow` job takes. */
  readyAfterMs?: number;
}

/** A request by Idempotency-Key: its body, and the answer it got (or is getting). */
interface Job {
  body: string;
  answer: Promise<Response>;
}

let state: { seed: NarrativeDraftMockSeed; readyAfterMs: number; jobs: Map<string, Job> } | null =
  null;

/** Starts the mock over: how the next drafts go, and no jobs. */
export function resetNarrativeDraftMock(
  seed: NarrativeDraftMockSeed,
  { readyAfterMs = 5000 }: Options = {},
): void {
  state = { seed, readyAfterMs, jobs: new Map() };
}

function ensureState() {
  state ??= {
    seed: envSchema.shape.REPORTING_MOCK_NARRATIVE.catch('inserted').parse(
      process.env.REPORTING_MOCK_NARRATIVE,
    ),
    readyAfterMs: 5000,
    jobs: new Map(),
  };
  return state;
}

const DRAFT_PATH = /^\/v1\/eacc\/national-reports\/(\d{4})\/narrative\/draft$/;

/** Whether `pathname` is the draft endpoint this part of the mock answers. */
export function isNarrativeDraftPath(pathname: string): boolean {
  return DRAFT_PATH.test(pathname);
}

const SECTIONS = ['overview', 'findings', 'recommendations', 'all'] as const;

function isSection(value: unknown): value is NarrativeDraftSection {
  return (SECTIONS as readonly unknown[]).includes(value);
}

export async function mockNarrativeDraftFetch(request: Request): Promise<Response> {
  const data = ensureState();
  const caller = mockCallerOf(request);
  if (!isEacc(caller)) {
    return problem(403, 'Only EACC analysts and supervisors draft the national report narrative.');
  }
  if (request.method !== 'POST') return problem(405, 'Method not allowed');
  const fy = Number(DRAFT_PATH.exec(new URL(request.url).pathname)?.[1]);
  const key = request.headers.get('idempotency-key');
  const body = await readJson(request);
  if (!key || !isRecord(body) || !isSection(body.section) || typeof body.replaceAll !== 'boolean') {
    return problem(400, 'Body failed validation, or Idempotency-Key missing');
  }
  const ask = { section: body.section, replaceAll: body.replaceAll };
  const report = ncrMockReport(fy);
  if (!report) {
    return problem(404, 'The national consolidated report for the year has not been built yet.');
  }
  const officer: Officer = {
    subject: caller.subject ?? 'unknown',
    name: caller.name ?? caller.subject ?? 'unknown',
  };

  // A retry reads the same job: a refusal as it was, a draft as it stands now.
  const replayKey = `${String(fy)}:${officer.subject}:${key}`;
  const replay = data.jobs.get(replayKey);
  if (replay) {
    if (replay.body !== JSON.stringify(ask)) {
      return problem(422, 'Idempotency-Key reused with a different request body');
    }
    const original = await replay.answer;
    return original.ok ? answer(report) : original.clone();
  }
  // Kept before the job is written, so a retry meanwhile waits for it rather than asks again.
  const answering = startDraft(report, officer, ask, data);
  data.jobs.set(replayKey, { body: JSON.stringify(ask), answer: answering });
  return (await answering).clone();
}

async function startDraft(
  report: StoredReport,
  officer: Officer,
  ask: { section: NarrativeDraftSection; replaceAll: boolean },
  data: NonNullable<typeof state>,
): Promise<Response> {
  if (report.status === 'approved') return approvedConflict();
  const candidates = mockCandidatesOf(report.aggregates);
  if ((ask.section === 'findings' || ask.section === 'all') && candidates.length === 0) {
    return problem(409, 'There are no pattern candidates to narrate.', 'no-pattern-candidates');
  }
  if (data.seed === 'unavailable') return problem(503, 'The ai-gateway could not be reached');

  await delay(1800);
  const jobId = crypto.randomUUID();
  if (!report.contributors.includes(officer.subject)) report.contributors.push(officer.subject);
  // A new request replaces a draft still being written, which is then never inserted.
  report.pendingDraft = null;
  const draft: NarrativeDraft = {
    jobId,
    section: ask.section,
    replaceAll: ask.replaceAll,
    status: 'drafting',
    failureReason: null,
    requestedAt: new Date().toISOString(),
    finishedAt: null,
  };
  report.narrativeDraft = draft;
  const builtAt = report.builtAt;
  const settle = (failure: string | null) => {
    const finish = (status: NarrativeDraft['status'], reason: string | null) => {
      Object.assign(draft, { status, failureReason: reason, finishedAt: new Date().toISOString() });
    };
    const discarded =
      report.status === 'approved'
        ? 'ncr-approved'
        : report.builtAt !== builtAt
          ? 'aggregates-rebuilt'
          : failure;
    if (discarded) {
      finish('failed', discarded);
      return;
    }
    report.paragraphs = insertDraft(report.paragraphs, ask, (section) =>
      draftParagraphs(section, report.aggregates, candidates),
    );
    touch(report, officer);
    finish('inserted', null);
  };

  switch (data.seed) {
    case 'validation':
      settle('validation');
      return problem(
        409,
        'The draft cited a figure that is not in the input and was discarded.',
        'narrative-validation',
      );
    case 'failed':
      settle('provider');
      return json(502, {
        type: 'about:blank',
        title: 'The AI narrative draft failed',
        status: 502,
        code: 'narrative-draft-failed',
        reason: 'provider',
      });
    case 'slow':
    case 'slow-validation':
      report.pendingDraft = {
        readyAt: Date.now() + data.readyAfterMs,
        settle: () => {
          settle(data.seed === 'slow-validation' ? 'validation' : null);
        },
      };
      return json(202, viewOf(report));
    default:
      settle(null);
      return answer(report);
  }
}

/** 200 once the draft has ended, 202 while it is still being written. */
function answer(report: StoredReport): Response {
  const view = viewOf(report);
  return json(view.narrativeDraft?.status === 'drafting' ? 202 : 200, view);
}

/**
 * The paragraphs with `fresh` ones for each section asked for: replacing those still marked as AI
 * drafts, where the first of them stood (at the end when there is none), or the whole section.
 */
export function insertDraft(
  paragraphs: readonly NarrativeParagraph[],
  ask: { section: NarrativeDraftSection; replaceAll: boolean },
  fresh: (section: NarrativeSectionId) => NarrativeParagraph[],
): NarrativeParagraph[] {
  const targets = sectionsDrafted(ask.section);
  return NARRATIVE_SECTION_IDS.flatMap((section) => {
    const current = paragraphs
      .filter((each) => each.section === section)
      .sort((a, b) => a.position - b.position);
    if (!targets.includes(section)) return current;
    const drafted = fresh(section);
    let next: NarrativeParagraph[];
    if (ask.replaceAll) next = drafted;
    else {
      const at = current.findIndex((each) => each.aiDraft);
      const kept = current.filter((each) => !each.aiDraft);
      const before =
        at < 0 ? kept.length : current.slice(0, at).filter((each) => !each.aiDraft).length;
      next = [...kept.slice(0, before), ...drafted, ...kept.slice(before)];
    }
    return next.map((each, position) => ({ ...each, position }));
  });
}

/** A rate (a fraction) as the report states it: `0.3444` → `34.4%`. */
const percent = (value: number | null) => formatPercent((value ?? 0) * 100);
const count = (value: number | null) => formatNumber(value ?? 0);

/** What the task writes for `section`, from the year's figures and candidates only. */
function draftParagraphs(
  section: NarrativeSectionId,
  aggregates: NationalAggregates,
  candidates: readonly PatternCandidate[],
): NarrativeParagraph[] {
  const national = nationalFigures(aggregates);
  const fyText = `FY ${String(aggregates.fy)}/${String(aggregates.fy + 1)}`;
  const ai = (text: string, aggregateRefs: string[], candidateIds: string[] = []) =>
    paragraph(section, 0, text, { aiDraft: true, aggregateRefs, candidateIds });
  if (section === 'overview') {
    return [
      ai(
        `${count(national.commissionsReported)} of ${count(national.commissions)} Commissions submitted Form M for ${fyText}; ${count(national.commissionsLate)} of them reported after the due date.`,
        ['national.commissionsReported', 'national.commissions', 'national.commissionsLate'],
      ),
      ai(
        `Across the reporting Commissions, ${count(national.filed)} of ${count(national.expected)} expected declarations were made, a national filing rate of ${percent(national.filingRate)}.`,
        ['national.filed', 'national.expected', 'national.filingRate'],
      ),
    ];
  }
  if (section === 'findings') {
    const firstOfKind = candidates.filter(
      (each, index) => candidates.findIndex((other) => other.kind === each.kind) === index,
    );
    return firstOfKind.map((candidate) =>
      ai(findingText(candidate, aggregates), candidate.aggregateKeys, [candidate.id]),
    );
  }
  const paragraphs = [
    ai(
      `EACC should follow up with each of the ${count(national.commissionsNotReported)} Commissions that did not report, and name them in this report.`,
      ['national.commissionsNotReported'],
      candidates.filter((each) => each.kind === 'non-reporting').map((each) => each.id),
    ),
  ];
  const breaches = candidates.filter((each) => each.kind === 'threshold-breach');
  // A Commission's breach, as the recommendation is about Commissions.
  const breach = breaches.find((each) => each.subject !== 'national');
  if (breach) {
    paragraphs.push(
      ai(
        `Commissions whose non-filer rate is above the ${percent(Number(breach.values.threshold))} threshold, the ${subjectName(breach.subject, aggregates)} at ${percent(Number(breach.values.nonFilerRate))} among them, should agree an improvement plan with EACC before the next biennial cycle.`,
        breach.aggregateKeys,
        breaches.map((each) => each.id),
      ),
    );
  }
  return paragraphs;
}

function subjectName(subject: string, aggregates: NationalAggregates): string {
  if (subject === 'national') return 'the nation';
  return aggregates.byCommission[subject]?.name ?? subject;
}

function findingText(candidate: PatternCandidate, aggregates: NationalAggregates): string {
  const { values } = candidate;
  const name = subjectName(candidate.subject, aggregates);
  const whose = candidate.subject === 'national' ? 'The national' : `The ${name}'s`;
  const number = (key: string) => Number(values[key]);
  switch (candidate.kind) {
    case 'rate-change':
      return `${whose} non-filer rate ${number('to') > number('from') ? 'rose' : 'fell'} from ${percent(number('from'))} last year to ${percent(number('to'))}.`;
    case 'threshold-breach':
      return `${whose} non-filer rate of ${percent(number('nonFilerRate'))} is above the ${percent(number('threshold'))} threshold.`;
    case 'chronic-late-reporting':
      return `The ${name} reported late ${count(number('years'))} years running.`;
    case 'size-band-outlier':
      return `${whose} non-filer rate of ${percent(number('nonFilerRate'))} is well above the ${percent(number('peerNonFilerRate'))} of Commissions its size.`;
    case 'clarification-ratio-outlier':
      return `${whose} clarifications per declaration, ${percent(number('clarificationRatio'))}, are far above the national ${percent(number('nationalRatio'))}.`;
    case 'non-reporting':
      return `The ${name} has not reported for ${count(number('years'))} year${number('years') === 1 ? '' : 's'} running.`;
  }
}

function delay(ms: number): Promise<void> {
  return process.env.VITEST ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
