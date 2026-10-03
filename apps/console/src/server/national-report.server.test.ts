import { beforeEach, describe, expect, it } from 'vitest';

import {
  approveNationalReport,
  buildNationalReport,
  loadNationalReportPage,
  nationalReportPdf,
  saveNationalReportNarrative,
} from './national-report.server';
import { mockReportingClient as sharedMockClient } from './reporting/mock.server';
import {
  mockNcrDocumentsClient,
  resetNcrMock as resetReportingMock,
} from './reporting/ncr-mock.server';

/** A reporting mock client as an EACC officer named `name`, whose subject follows the name. */
function mockReportingClient(name: string, roles: readonly string[]) {
  return sharedMockClient(roles, {
    name,
    subject: `user-${name.toLowerCase().replace(/\W+/g, '-')}`,
    tenant: 'eacc',
  });
}

const ANALYST = ['eacc-analyst'];
const SUPERVISOR = ['eacc-supervisor'];

const analyst = (name = 'Baraka Mutua') => mockReportingClient(name, ANALYST);
const supervisor = (name = 'Nafula Wekesa') => mockReportingClient(name, SUPERVISOR);

const EMPTY = { overview: '', findings: '', recommendations: '' };

beforeEach(() => {
  resetReportingMock('not-built');
});

describe('S11 loadNationalReportPage', () => {
  it('reads a year not built yet as no report, with how many Commissions reported', async () => {
    const page = await loadNationalReportPage(analyst(), 2025);

    expect(page).toEqual({
      ok: true,
      data: { fy: 2025, report: null, reported: 11, notReported: 3 },
    });
  });

  it('reads the current year, which nobody has reported for yet', async () => {
    const page = await loadNationalReportPage(analyst(), 2026);

    expect(page).toMatchObject({ ok: true, data: { report: null, reported: 0, notReported: 14 } });
  });

  it('answers 403 to anyone outside EACC', async () => {
    const page = await loadNationalReportPage(mockReportingClient('Amina', ['supervisor']), 2025);

    expect(page).toMatchObject({ ok: false, error: { kind: 'problem', problem: { status: 403 } } });
  });

  it('reads the aggregates of a built report', async () => {
    resetReportingMock('draft');

    const page = await loadNationalReportPage(analyst(), 2025);

    if (!page.ok || !page.data.report) throw new Error('expected a report');
    const { report } = page.data;
    expect(report.status).toBe('draft');
    expect(report.reportsIncluded).toBe(11);
    expect(report.author?.name).toBe('Brian Otieno');
    expect(report.aggregates.reporting).toMatchObject({ reported: 11, onTime: 8, late: 3 });
    expect(report.aggregates.byCommission.tsc).toMatchObject({
      name: 'Teachers Service Commission',
      status: 'submitted-late',
      initial: { expected: 9412, declared: 8960 },
    });
    expect(report.aggregates.byCommission.cpsbkwale).toMatchObject({
      status: 'not-reported',
      initial: null,
    });
    expect(report.narrative.overview).toMatch(/^This report consolidates/);
  });

  it('counts a report received after the build, which a rebuild takes in', async () => {
    resetReportingMock('stale');

    const page = await loadNationalReportPage(analyst(), 2025);

    expect(page).toMatchObject({
      ok: true,
      data: { reported: 12, report: { reportsIncluded: 11 } },
    });
  });
});

describe('S11 buildNationalReport', () => {
  it('builds from the submitted reports and makes the caller the author', async () => {
    const built = await buildNationalReport(analyst(), 2025);

    expect(built).toMatchObject({
      ok: true,
      data: {
        status: 'draft',
        reportsIncluded: 11,
        author: { name: 'Baraka Mutua' },
        aggregates: { national: { initial: { expected: 21_239, declared: 20_402 } } },
      },
    });
  });

  it('keeps the narrative when it rebuilds', async () => {
    resetReportingMock('stale');

    const rebuilt = await buildNationalReport(analyst(), 2025);

    expect(rebuilt).toMatchObject({
      ok: true,
      data: { reportsIncluded: 12, author: { name: 'Brian Otieno' } },
    });
    if (rebuilt.ok) expect(rebuilt.data.narrative.overview).toMatch(/^This report consolidates/);
  });

  it('refuses a year nobody has reported for (409 no-submitted-reports)', async () => {
    const built = await buildNationalReport(analyst(), 2026);

    expect(built).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'no-submitted-reports' } },
    });
  });
});

describe('S11 saveNationalReportNarrative', () => {
  it('saves each section as text, paragraphs split at blank lines', async () => {
    await buildNationalReport(analyst(), 2025);

    const saved = await saveNationalReportNarrative(analyst(), 2025, {
      ...EMPTY,
      findings: 'Forty-two reported.\n\nTen of them late.',
    });

    if (!saved.ok) throw new Error('expected the save to succeed');
    expect(saved.data.narrativeParagraphs.map(({ section, text }) => [section, text])).toEqual([
      ['findings', 'Forty-two reported.'],
      ['findings', 'Ten of them late.'],
    ]);
  });

  it('keeps an unchanged paragraph and its id; an edited one stops being an AI draft', async () => {
    resetReportingMock('draft');
    const before = await loadNationalReportPage(analyst(), 2025);
    if (!before.ok || !before.data.report) throw new Error('expected a report');
    const [kept, drafted] = before.data.report.narrativeParagraphs.filter(
      (paragraph) => paragraph.section === 'findings',
    );
    if (!kept || !drafted) throw new Error('expected two findings');
    expect(drafted.aiDraft).toBe(true);

    const saved = await saveNationalReportNarrative(analyst(), 2025, {
      ...before.data.report.narrative,
      findings: `${kept.text}\n\n${drafted.text} Edited.`,
    });

    if (!saved.ok) throw new Error('expected the save to succeed');
    const findings = saved.data.narrativeParagraphs.filter((each) => each.section === 'findings');
    expect(findings[0]).toEqual(kept);
    expect(findings[1]).toMatchObject({ id: drafted.id, aiDraft: false });
  });

  it('refuses a section over its limit (400)', async () => {
    await buildNationalReport(analyst(), 2025);

    const saved = await saveNationalReportNarrative(analyst(), 2025, {
      ...EMPTY,
      overview: 'x'.repeat(20_001),
    });

    expect(saved).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400 } },
    });
  });

  it('is 404 before the first build', async () => {
    const saved = await saveNationalReportNarrative(analyst(), 2025, EMPTY);

    expect(saved).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });
});

describe('S11 approveNationalReport', () => {
  it('lets an EACC supervisor who did not write it approve: NCR reference, then the PDF', async () => {
    resetReportingMock('draft', { pdfDelayMs: 0 });

    const approved = await approveNationalReport(supervisor(), 2025, crypto.randomUUID());

    expect(approved).toMatchObject({
      ok: true,
      data: {
        status: 'approved',
        reference: 'NCR-EACC-2026-0000001-V',
        approver: { name: 'Nafula Wekesa' },
      },
    });
    const page = await loadNationalReportPage(supervisor(), 2025);
    expect(page.ok && typeof page.data.report?.documentId).toBe('string');
  });

  it('refuses the author (403 separation-of-duties)', async () => {
    const author = supervisor('Esther Chebet');
    await buildNationalReport(author, 2025);

    const approved = await approveNationalReport(author, 2025, crypto.randomUUID());

    expect(approved).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403, code: 'separation-of-duties' } },
    });
  });

  it('refuses a supervisor who saved part of the narrative (403 separation-of-duties)', async () => {
    resetReportingMock('draft');
    const writer = supervisor();
    await saveNationalReportNarrative(writer, 2025, EMPTY);

    const approved = await approveNationalReport(writer, 2025, crypto.randomUUID());

    expect(approved).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403, code: 'separation-of-duties' } },
    });
  });

  it('refuses an EACC analyst (403)', async () => {
    resetReportingMock('draft');

    const approved = await approveNationalReport(analyst(), 2025, crypto.randomUUID());

    expect(approved).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('replays a retry with the same key; another approval is 409 ncr-approved', async () => {
    resetReportingMock('draft');
    const key = crypto.randomUUID();
    const first = await approveNationalReport(supervisor(), 2025, key);

    const replay = await approveNationalReport(supervisor(), 2025, key);
    const again = await approveNationalReport(supervisor(), 2025, crypto.randomUUID());

    expect(replay).toEqual(first);
    expect(again).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'ncr-approved' } },
    });
  });
});

describe('S11 nationalReportPdf', () => {
  it('hands EACC a short-lived link to the approved PDF', async () => {
    resetReportingMock('approved');
    const page = await loadNationalReportPage(analyst(), 2025);
    const documentId = page.ok ? page.data.report?.documentId : null;
    if (!documentId) throw new Error('expected the PDF');

    const link = await nationalReportPdf(mockNcrDocumentsClient(ANALYST), documentId);

    expect(link).toMatchObject({
      ok: true,
      data: { downloadUrl: `/api/mock-files/${documentId}` },
    });
  });
});
