import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  draftNationalReportNarrative,
  loadNationalReport,
  type NarrativeDraftRequest,
  saveNationalReportNarrative,
} from './national-report.server';
import { resetCandidatesMock } from './reporting/candidates-mock.server';
import { setEaccIntakeMockLatency } from './reporting/eacc-mock.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from './reporting/mock.server';
import { resetNarrativeDraftMock } from './reporting/narrative-draft-mock.server';
import { resetNcrMock } from './reporting/ncr-mock.server';
import type { NarrativeParagraph, NationalReport } from './reporting/types';

const as = (roles: readonly string[] = ['eacc-analyst']) =>
  mockReportingClient(roles, { name: 'Baraka Mutua', subject: 'user-baraka', tenant: 'eacc' });

const draft = (
  request: NarrativeDraftRequest,
  key: string = crypto.randomUUID(),
  roles?: string[],
) => draftNationalReportNarrative(as(roles), 2025, request, key);

function reportOf(result: Awaited<ReturnType<typeof draft>>): NationalReport {
  if (!result.ok) throw new Error(`expected a report, got ${JSON.stringify(result.error)}`);
  return result.data;
}

const section = (report: NationalReport, id: NarrativeParagraph['section']) =>
  report.narrativeParagraphs.filter((each) => each.section === id);

// The seeded draft: an overview the analyst wrote; findings typed, then one AI draft.
const OVERVIEW =
  'This report consolidates the compliance reports (Form M) received from Responsible Commissions';
const TYPED_FINDING = 'Eleven of fifteen Commissions reported, three of them late.';
const AI_FINDING = 'The Nairobi City County Public Service Board reports a biennial rate of 62%';

beforeEach(() => {
  setReportingMockLatency(0);
  setEaccIntakeMockLatency(0);
  // FY 2025/2026's reports are in.
  resetReportingMock('2026-10-03');
  resetNcrMock('draft');
  resetCandidatesMock('computed');
  resetNarrativeDraftMock('inserted');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('S2 draftNationalReportNarrative', () => {
  it('inserts AI-draft paragraphs in every section, each citing figures, and keeps what the analyst wrote', async () => {
    const report = reportOf(await draft({ section: 'all', replaceAll: false }));

    expect(report.narrativeDraft).toMatchObject({ section: 'all', status: 'inserted' });
    const overview = section(report, 'overview');
    expect(overview[0]).toMatchObject({ aiDraft: false });
    expect(overview[0]?.text).toContain(OVERVIEW);
    const drafted = report.narrativeParagraphs.filter((each) => each.aiDraft);
    expect(new Set(drafted.map((each) => each.section))).toEqual(
      new Set(['overview', 'findings', 'recommendations']),
    );
    for (const each of drafted) expect(each.aggregateRefs.length).toBeGreaterThan(0);
    // Findings narrate the candidates, citing them; the seeded AI finding was replaced.
    const findings = section(report, 'findings');
    expect(findings[0]).toMatchObject({ aiDraft: false });
    expect(findings[0]?.text).toContain(TYPED_FINDING);
    expect(findings.slice(1).every((each) => each.aiDraft && each.candidateIds.length > 0)).toBe(
      true,
    );
    expect(findings.some((each) => each.text.includes(AI_FINDING))).toBe(false);
    expect(findings.map((each) => each.position)).toEqual(findings.map((_, index) => index));
  });

  it('states only figures of the year, as the cited keys give them', async () => {
    const report = reportOf(await draft({ section: 'overview', replaceAll: false }));

    const [first, second] = section(report, 'overview').filter((each) => each.aiDraft);
    // 11 of 15 Commissions reported, 3 of them late (the intake mock's day).
    expect(first).toMatchObject({
      aggregateRefs: [
        'national.commissionsReported',
        'national.commissions',
        'national.commissionsLate',
      ],
    });
    expect(first?.text).toMatch(/^\d+ of \d+ Commissions submitted Form M for FY 2025\/2026/);
    expect(second?.aggregateRefs).toEqual([
      'national.filed',
      'national.expected',
      'national.filingRate',
    ]);
    // Only the overview was drafted: the findings are as they were.
    expect(section(report, 'findings').map((each) => each.aiDraft)).toEqual([false, true]);
  });

  it('S3 redrafting a section replaces only its AI-draft paragraphs, where the first stood', async () => {
    const first = reportOf(await draft({ section: 'findings', replaceAll: false }));
    const drafted = section(first, 'findings').filter((each) => each.aiDraft);

    const again = reportOf(await draft({ section: 'findings', replaceAll: false }));

    const findings = section(again, 'findings');
    expect(findings[0]?.text).toContain(TYPED_FINDING);
    expect(findings.slice(1).map((each) => each.text)).toEqual(drafted.map((each) => each.text));
    expect(findings.slice(1).some((each) => drafted.some((old) => old.id === each.id))).toBe(false);
  });

  it('S3 replace all replaces the whole section, the analyst’s paragraphs too', async () => {
    const report = reportOf(await draft({ section: 'findings', replaceAll: true }));

    const findings = section(report, 'findings');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((each) => each.aiDraft)).toBe(true);
    // Another section is left alone.
    expect(section(report, 'overview')[0]?.text).toContain(OVERVIEW);
  });

  it('S3 an edited AI-draft paragraph is no longer one once saved', async () => {
    const report = reportOf(await draft({ section: 'recommendations', replaceAll: false }));
    const [edited, kept] = section(report, 'recommendations');
    if (!edited || !kept) throw new Error('expected two recommendations');

    const saved = await saveNationalReportNarrative(as(), 2025, {
      ...report.narrative,
      recommendations: `${edited.text} Within 30 days.\n\n${kept.text}`,
    });

    if (!saved.ok) throw new Error('expected the save to succeed');
    expect(section(saved.data, 'recommendations')).toMatchObject([
      { id: edited.id, aiDraft: false },
      { id: kept.id, aiDraft: true },
    ]);
  });

  it('inserts a draft once for a retry with the same Idempotency-Key', async () => {
    const key = crypto.randomUUID();
    const first = reportOf(await draft({ section: 'overview', replaceAll: false }, key));

    const retry = reportOf(await draft({ section: 'overview', replaceAll: false }, key));

    expect(retry.narrativeParagraphs).toEqual(first.narrativeParagraphs);
    expect(retry.version).toBe(first.version);
  });

  it('S2 discards a draft that failed validation, inserting nothing', async () => {
    resetNarrativeDraftMock('validation');
    const before = await loadNationalReport(as(), 2025);

    const result = await draft({ section: 'all', replaceAll: false });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'narrative-validation' } },
    });
    const after = await loadNationalReport(as(), 2025);
    if (!before.ok || !after.ok) throw new Error('expected the report');
    expect(after.data.narrativeParagraphs).toEqual(before.data.narrativeParagraphs);
    expect(after.data.narrativeDraft).toMatchObject({
      status: 'failed',
      failureReason: 'validation',
    });
  });

  it('answers 202 while the job runs; reading the report inserts it once it has ended', async () => {
    resetNarrativeDraftMock('slow', { readyAfterMs: 60_000 });

    const started = await draft({ section: 'overview', replaceAll: false });

    const drafting = reportOf(started);
    expect(drafting.narrativeDraft).toMatchObject({ status: 'drafting', section: 'overview' });
    expect(section(drafting, 'overview').some((each) => each.aiDraft)).toBe(false);
    const still = await loadNationalReport(as(), 2025);
    expect(still).toMatchObject({ ok: true, data: { narrativeDraft: { status: 'drafting' } } });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    const ended = await loadNationalReport(as(), 2025);

    if (!ended.ok) throw new Error('expected the report');
    expect(ended.data.narrativeDraft).toMatchObject({ status: 'inserted' });
    expect(section(ended.data, 'overview').filter((each) => each.aiDraft)).toHaveLength(2);
  });

  it('a job that ends failing validation is discarded when the report is read', async () => {
    resetNarrativeDraftMock('slow-validation', { readyAfterMs: 0 });

    reportOf(await draft({ section: 'all', replaceAll: false }));
    const ended = await loadNationalReport(as(), 2025);

    if (!ended.ok) throw new Error('expected the report');
    expect(ended.data.narrativeDraft).toMatchObject({
      status: 'failed',
      failureReason: 'validation',
    });
    expect(section(ended.data, 'findings').map((each) => each.aiDraft)).toEqual([false, true]);
  });

  it('is unavailable when the ai-gateway fails the job or cannot be reached', async () => {
    resetNarrativeDraftMock('failed');
    expect(await draft({ section: 'all', replaceAll: false })).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });

    resetNarrativeDraftMock('unavailable');
    expect(await draft({ section: 'all', replaceAll: false })).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });

  it('has no findings to draft without pattern candidates', async () => {
    resetCandidatesMock('none');

    expect(await draft({ section: 'findings', replaceAll: false })).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'no-pattern-candidates' } },
    });
  });

  it('drafts nothing once the report is approved', async () => {
    resetNcrMock('approved', { pdfDelayMs: 0 });

    expect(await draft({ section: 'all', replaceAll: false })).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'ncr-approved' } },
    });
  });

  it('is 404 before the year is built, and 403 to anyone outside EACC', async () => {
    expect(
      await draft({ section: 'all', replaceAll: false }, undefined, ['supervisor']),
    ).toMatchObject({ ok: false, error: { kind: 'problem', problem: { status: 403 } } });

    resetNcrMock('not-built');
    expect(await draft({ section: 'all', replaceAll: false })).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });
});
