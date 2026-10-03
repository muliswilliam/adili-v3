// @vitest-environment jsdom
import { EACC_ANALYST } from '@adili/roles';
import { TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EaccResult,
  loadIntake,
  loadSubmittedReport,
  type ReportView,
} from '../../server/eacc-intake.server';
import {
  resetEaccIntakeMock,
  setEaccIntakeMockLatency,
} from '../../server/reporting/eacc-mock.server';
import { mockReportingClient } from '../../server/reporting/mock.server';
import { ReportViewer } from './report-viewer';

const invalidate = vi.fn(() => Promise.resolve());
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

beforeAll(() => {
  setEaccIntakeMockLatency(0);
});
afterAll(() => {
  setEaccIntakeMockLatency(1);
});
beforeEach(() => {
  invalidate.mockClear();
  resetEaccIntakeMock('2026-10-03');
});

const analyst = () => mockReportingClient([EACC_ANALYST], { tenant: 'eacc' });

async function reportOf(slug: string): Promise<EaccResult<ReportView>> {
  const intake = await loadIntake(analyst(), 2025);
  if (!intake.ok) throw new Error('no intake');
  const row = intake.data.commissions.find((commission) => commission.commission.slug === slug);
  return loadSubmittedReport(analyst(), row?.reportId ?? '');
}

function show(
  result: EaccResult<ReportView> | null,
  onDownload = vi.fn<(documentId: string) => Promise<boolean>>(() => Promise.resolve(true)),
) {
  render(
    <TooltipProvider>
      <ReportViewer
        result={result}
        backLink={<a href="/eacc/reports">All reports</a>}
        onDownload={onDownload}
      />
    </TooltipProvider>,
  );
  return { onDownload };
}

describe('the report viewer (S9, S15)', () => {
  it('shows a loading skeleton while the report loads', () => {
    show(null);
    expect(screen.getByLabelText('Loading the report').getAttribute('aria-busy')).toBe('true');
  });

  it('offers a retry when the report could not load', () => {
    show({ ok: false, error: { kind: 'unavailable', detail: null } });
    expect(screen.getByText('We could not load the report')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('says a report it cannot show is not found (404)', () => {
    show({
      ok: false,
      error: { kind: 'problem', problem: { type: 'about:blank', title: 'Not found', status: 404 } },
    });
    expect(screen.getByText('Report not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All reports' })).toBeTruthy();
  });

  it("reads psc's report as filed: its reference, sign-off, the form and its rates", async () => {
    show(await reportOf('psc'));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Public Service Commission' }),
    ).toBeTruthy();
    expect(screen.getByText('Reported on time')).toBeTruthy();
    expect(screen.getByText('Hosted on Adili')).toBeTruthy();
    expect(screen.getByText('Restricted')).toBeTruthy();
    const facts = within(screen.getByRole('region', { name: 'Report details' }));
    expect(facts.getByText('RPT-PSC-2026-0000001-K')).toBeTruthy();
    expect(facts.getByText('28 Jul 2026, 11:05')).toBeTruthy();
    expect(facts.getByText('FY 2025/2026, due 31 Jul 2026')).toBeTruthy();
    expect(facts.getByText('Samuel Njoroge')).toBeTruthy();
    expect(facts.getByText('Dr. Mary Wambui')).toBeTruthy();
    // The form as the Commission filed it.
    expect(
      screen.getByRole('heading', { name: 'Part I: Description of the Responsible Commission' }),
    ).toBeTruthy();
    expect(screen.getByText('compliance@publicservice.go.ke')).toBeTruthy();
    expect(
      screen.getByRole('table', {
        name: /Section 1\(d\): List of officers who did not submit initial declaration/,
      }),
    ).toBeTruthy();
    const rates = within(screen.getByRole('region', { name: 'Rates' }));
    expect(rates.getByText('Final declarations')).toBeTruthy();
    expect(rates.getByText('75%')).toBeTruthy();
    const outliers = within(screen.getByRole('region', { name: 'Outliers' }));
    expect(outliers.getByText('Low final rate')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Chasing' })).getByText('Not chased.'),
    ).toBeTruthy();
  });

  it('marks a late report filed through its own system, with the days late and its chases', async () => {
    show(await reportOf('tsc'));
    expect(screen.getByText('Reported late')).toBeTruthy();
    expect(screen.getByText('Submitted via API')).toBeTruthy();
    expect(screen.getByText('(12 days late)')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Chasing' })).getByText(
        'Chased 2 times, last 8 Aug 2026',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Outliers' })).getByText(
        'No outliers for this report.',
      ),
    ).toBeTruthy();
  });

  it('downloads the Form M PDF and the receipt', async () => {
    const result = await reportOf('psc');
    const { onDownload } = show(result);
    if (!result.ok) throw new Error('no report');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download Form M (PDF)' }));
      await Promise.resolve();
    });
    expect(onDownload).toHaveBeenCalledWith(result.data.report.formMDocumentId);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download the acknowledgement receipt' }));
      await Promise.resolve();
    });
    expect(onDownload).toHaveBeenCalledWith(result.data.report.receiptDocumentId);
  });

  it('says so when a download fails', async () => {
    show(
      await reportOf('psc'),
      vi.fn(() => Promise.resolve(false)),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download Form M (PDF)' }));
      await Promise.resolve();
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'We could not download the file. Try again.',
    );
  });

  it('disables a download whose document is not issued yet', async () => {
    const result = await reportOf('psc');
    if (!result.ok) throw new Error('no report');
    show({
      ok: true,
      data: { ...result.data, report: { ...result.data.report, formMDocumentId: null } },
    });
    expect(
      screen.getByRole('button', { name: 'Download Form M (PDF)' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
