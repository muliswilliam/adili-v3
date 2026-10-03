import { EACC_ANALYST, EACC_SUPERVISOR, PLATFORM_ADMIN, REVIEWER } from '@adili/roles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDocumentsClient } from './documents/client';
import { loadIntake, loadSubmittedReport, reportFileLink } from './eacc-intake.server';
import {
  mockReportingDocumentsFetch,
  setEaccIntakeMockLatency,
} from './reporting/eacc-mock.server';
import { mockReportingClient, resetReportingMock, submitMockReport } from './reporting/mock.server';
import { unsignedMockToken } from './mock-http';

const analyst = () => mockReportingClient([EACC_ANALYST], { tenant: 'eacc', name: 'Brian Otieno' });

beforeAll(() => {
  setEaccIntakeMockLatency(0);
});
afterAll(() => {
  setEaccIntakeMockLatency(1);
});
beforeEach(() => {
  resetReportingMock('2026-10-03');
  // The Public Service Commission files on 28 July, on time (spec 09 S9).
  submitMockReport(2025, '2026-07-28');
});

async function intake(client: ReturnType<typeof mockReportingClient>, fy = 2025) {
  const result = await loadIntake(client, fy);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

const row = (data: Awaited<ReturnType<typeof intake>>, slug: string) => {
  const found = data.commissions.find((commission) => commission.commission.slug === slug);
  if (!found) throw new Error(`no row for ${slug}`);
  return found;
};

describe('the EACC intake (S9)', () => {
  it('shows psc on time, tsc late and jsc not reported, with totals for the year', async () => {
    const data = await intake(analyst());
    expect(data.fy).toBe(2025);
    expect(row(data, 'psc')).toMatchObject({
      status: 'submitted-on-time',
      reference: 'RPT-PSC-2026-0000001-K',
    });
    expect(row(data, 'tsc').status).toBe('submitted-late');
    expect(row(data, 'jsc')).toMatchObject({ status: 'not-reported', reportId: null, rates: {} });
    expect(data.totals).toMatchObject({ onTime: 9, late: 3, notReported: 3 });
    expect(data.totals.nationalDeclaredRate).toBeGreaterThan(0.9);
  });

  it('computes each section rate and the outliers from the reports as filed', async () => {
    const data = await intake(analyst());
    // The spec 09 fixture: 12 appointed and 10 filed, 100 and 95, 4 exits and 3 final.
    expect(row(data, 'psc').rates).toEqual({
      initial: { expected: 12, declared: 10, rate: 0.8333 },
      biennial: { expected: 100, declared: 95, rate: 0.95 },
      final: { expected: 4, declared: 3, rate: 0.75 },
    });
    expect(row(data, 'psc').outliers).toEqual(['low-final-rate']);
    expect(row(data, 'cpsb047').outliers).toEqual(['low-biennial-rate']);
    expect(row(data, 'cpsb001').outliers).toEqual(['section-missing']);
    expect(row(data, 'parlsc').outliers).toEqual([]);
  });

  it('counts the weekly chases from 1 August while a Commission has not reported', async () => {
    const data = await intake(analyst());
    // Every Saturday from 1 August 2026 to today, Saturday 3 October: ten rounds.
    expect(row(data, 'jsc').chases).toEqual({ count: 10, lastAt: '2026-10-03T03:00:00.000Z' });
    // Chased on 1 and 8 August, then filed on 12 August.
    expect(row(data, 'tsc').chases).toEqual({ count: 2, lastAt: '2026-08-08T03:00:00.000Z' });
    expect(row(data, 'psc').chases).toEqual({ count: 0, lastAt: null });
  });

  it('has every Commission not reported yet in the year that is still running', async () => {
    const data = await intake(analyst(), 2026);
    expect(data.totals).toEqual({
      onTime: 0,
      late: 0,
      notReported: 15,
      nationalDeclaredRate: null,
    });
    expect(data.commissions.every((commission) => commission.chases.count === 0)).toBe(true);
  });

  it('shows psc as the Form M workspace has it: not reported while a draft, then as submitted', async () => {
    resetReportingMock('2026-10-03');
    const draft = row(await intake(analyst()), 'psc');
    expect(draft).toMatchObject({ status: 'not-reported', reportId: null });
    expect(draft.chases.count).toBe(10);
    submitMockReport(2025, '2026-10-02');
    expect(row(await intake(analyst()), 'psc')).toMatchObject({
      status: 'submitted-late',
      reference: 'RPT-PSC-2026-0000001-K',
      submittedAt: '2026-10-02T08:20:00.000Z',
      chases: { count: 9, lastAt: '2026-09-26T03:00:00.000Z' },
    });
  });

  it('validates the query before the caller, and takes any year from 2025', async () => {
    const reviewer = mockReportingClient([REVIEWER], { tenant: 'psc' });
    expect(await loadIntake(reviewer, 2024)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400 } },
    });
    expect((await intake(analyst(), 2030)).totals.notReported).toBe(15);
  });

  it('is the same for an EACC supervisor', async () => {
    const data = await intake(mockReportingClient([EACC_SUPERVISOR], { tenant: 'eacc' }));
    expect(data.commissions).toHaveLength(15);
  });

  it('refuses a Commission reviewer and a platform admin (403)', async () => {
    for (const client of [
      mockReportingClient([REVIEWER], { tenant: 'psc' }),
      mockReportingClient([PLATFORM_ADMIN], { tenant: 'platform' }),
    ]) {
      const result = await loadIntake(client, 2025);
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'problem', problem: { status: 403 } },
      });
    }
  });
});

async function pscReportId() {
  return row(await intake(analyst()), 'psc').reportId ?? '';
}

describe('the report viewer (S9)', () => {
  it("opens psc's report as filed, with its rates, outliers and chases from the intake", async () => {
    const result = await loadSubmittedReport(analyst(), await pscReportId());
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { report, intake: line } = result.data;
    expect(report).toMatchObject({
      commission: { slug: 'psc', name: 'Public Service Commission' },
      fy: 2025,
      status: 'submitted',
      late: false,
      reference: 'RPT-PSC-2026-0000001-K',
    });
    expect(report.document.partII.initial).toMatchObject({ expected: 12, declared: 10 });
    expect(report.document.partII.initial.nonFilers).toHaveLength(2);
    expect(report.formMDocumentId).not.toBeNull();
    expect(line).toMatchObject({ status: 'submitted-on-time', outliers: ['low-final-rate'] });
  });

  it("is not found for a Commission reviewer, another Commission's staff or an unknown id", async () => {
    const id = await pscReportId();
    for (const [client, reportId] of [
      [mockReportingClient([REVIEWER], { tenant: 'psc' }), id],
      [mockReportingClient(['supervisor'], { tenant: 'tsc' }), id],
      [analyst(), '0199c100-0000-7000-8000-202500000099'],
    ] as const) {
      const result = await loadSubmittedReport(client, reportId);
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'problem', problem: { status: 404 } },
      });
    }
  });

  it('opens the report without its intake line when the intake cannot be read', async () => {
    const id = await pscReportId();
    const result = await loadSubmittedReport(
      mockReportingClient(['supervisor'], { tenant: 'psc' }),
      id,
    );
    expect(result).toMatchObject({ ok: true, data: { intake: null } });
  });

  it('hands EACC a short-lived link to the Form M PDF and the receipt', async () => {
    const intakeRow = row(await intake(analyst()), 'psc');
    const documents = createDocumentsClient({
      baseUrl: 'http://documents.test',
      accessToken: unsignedMockToken({
        subject: 'mock-analyst',
        name: 'Brian Otieno',
        roles: [EACC_ANALYST],
        tenant: 'eacc',
      }),
      mock: mockReportingDocumentsFetch,
    });
    const link = await reportFileLink(documents, intakeRow.formMDocumentId ?? '');
    expect(link).toMatchObject({
      ok: true,
      data: { downloadUrl: expect.stringContaining('/api/mock-files/') as unknown },
    });
    expect(await reportFileLink(documents, '0199c900-0000-7000-8000-202500000001')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });
});
