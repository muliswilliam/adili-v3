import { COMMISSION_ADMIN, REPORTING_OFFICER, REVIEWER, SUPERVISOR } from '@adili/roles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compileReport, loadWorkspace } from './form-m.server';
import {
  mockReportingClient,
  mockReportingFetch,
  resetReportingMock,
  setReportingMockLatency,
} from './reporting/mock.server';

const supervisor = () => mockReportingClient([SUPERVISOR]);

beforeAll(() => {
  setReportingMockLatency(0);
});
afterAll(() => {
  setReportingMockLatency(1);
});

async function workspace(
  client: ReturnType<typeof mockReportingClient>,
  fy?: number,
  today = '2026-10-03',
) {
  const result = await loadWorkspace(client, 'psc', { fy, today });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

describe('the Form M workspace (S2, S15)', () => {
  it('lists the periods newest first and opens the overdue draft by default', async () => {
    resetReportingMock('2026-10-03');
    const data = await workspace(supervisor());
    expect(data.periods.map((period) => [period.fy, period.status])).toEqual([
      [2026, 'not-started'],
      [2025, 'draft'],
    ]);
    expect(data.fy).toBe(2025);
    expect(data.today).toBe('2026-10-03');
    expect(data.report?.status).toBe('draft');
    expect(data.report?.document?.partII.initial).toMatchObject({
      expected: 12,
      declared: 10,
      notDeclared: 2,
    });
    expect(data.report?.document?.partII.clarifications.items).toHaveLength(6);
    expect(data.report?.accessDataUnavailable).toBe(true);
  });

  it('opens a year without a report as not started, without reading a report', async () => {
    resetReportingMock('2026-10-03');
    const data = await workspace(supervisor(), 2026);
    expect(data.fy).toBe(2026);
    expect(data.report).toBeNull();
    expect(data.periods[0]?.previewAvailable).toBe(false);
  });

  it('falls back to the default period for a year that is not listed', async () => {
    resetReportingMock('2026-10-03');
    expect((await workspace(supervisor(), 2019)).fy).toBe(2025);
  });

  it('lets the commission-admin and the reporting officer read the draft', async () => {
    resetReportingMock('2026-10-03');
    for (const role of [COMMISSION_ADMIN, REPORTING_OFFICER]) {
      const data = await workspace(mockReportingClient([role]));
      expect(data.report?.status).toBe('draft');
    }
  });

  it('answers 404 to other roles, as the service does', async () => {
    resetReportingMock('2026-10-03');
    const result = await loadWorkspace(mockReportingClient([REVIEWER]), 'psc', {
      today: '2026-10-03',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('answers 404 for another Commission', async () => {
    resetReportingMock('2026-10-03');
    const result = await loadWorkspace(supervisor(), 'tsc', { today: '2026-10-03' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });
});

describe('compiling a preview (S2, S4)', () => {
  it('refuses a preview before 1 April with preview-not-available', async () => {
    resetReportingMock('2026-10-03');
    const result = await compileReport(supervisor(), 'psc', 2026);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'preview-not-available' } },
    });
  });

  it('compiles a preview from 1 April: compiling, then a draft with no biennial cycle', async () => {
    resetReportingMock('2027-04-10');
    const before = await workspace(supervisor(), 2026, '2027-04-10');
    expect(before.periods[0]).toMatchObject({
      fy: 2026,
      status: 'not-started',
      previewAvailable: true,
    });
    expect(before.periods[1]).toMatchObject({ fy: 2025, status: 'submitted', late: true });

    expect(await compileReport(supervisor(), 'psc', 2026)).toEqual({ ok: true, data: null });
    const compiling = await workspace(supervisor(), 2026, '2027-04-10');
    expect(compiling.report).toMatchObject({ status: 'compiling', document: null });

    setReportingMockLatency(0, { compileMs: 0 });
    const compiled = await workspace(supervisor(), 2026, '2027-04-10');
    setReportingMockLatency(0);
    expect(compiled.report?.status).toBe('draft');
    expect(compiled.report?.document?.partII.biennial).toMatchObject({
      noCycleInPeriod: true,
      expected: 0,
    });
    expect(compiled.report?.accessDataUnavailable).toBe(false);
  });

  it('lets only the supervisor compile (403)', async () => {
    resetReportingMock('2027-04-10');
    const result = await compileReport(mockReportingClient([COMMISSION_ADMIN]), 'psc', 2026);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('refuses to recompile a submitted report (409 report-submitted)', async () => {
    resetReportingMock('2027-04-10');
    const result = await compileReport(supervisor(), 'psc', 2025);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'report-submitted' } },
    });
  });
});

describe('a compile finishing while the workspace loads', () => {
  it('shows the selected year as the report reads, not as listed a moment before', async () => {
    resetReportingMock('2027-04-10');
    await compileReport(supervisor(), 'psc', 2026);
    let listed = false;
    // The list is read while compiling; the compile finishes before the report is read.
    const client = mockReportingClient([SUPERVISOR], {
      fetch: async (request) => {
        const answer = await mockReportingFetch(request);
        if (!listed) {
          listed = true;
          setReportingMockLatency(0, { compileMs: 0 });
        }
        return answer;
      },
    });
    const result = await loadWorkspace(client, 'psc', { fy: 2026, today: '2027-04-10' });
    setReportingMockLatency(0);
    if (!result.ok) throw new Error('not ok');
    expect(result.data.report?.status).toBe('draft');
    expect(result.data.periods[0]?.status).toBe('draft');
  });
});

describe('the report document', () => {
  it('reads a report whose document is not form-m.v1 as unavailable (contract drift)', async () => {
    resetReportingMock('2026-10-03', { corruptDocument: true });
    const result = await loadWorkspace(supervisor(), 'psc', { today: '2026-10-03' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});
