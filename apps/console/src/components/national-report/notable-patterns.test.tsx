// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { type ComponentProps, StrictMode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadNationalReport,
  loadNationalReportPage,
  type NationalReportLoad,
  saveNationalReportNarrative,
} from '../../server/national-report.server';
import { loadPatternCandidates } from '../../server/pattern-candidates.server';
import {
  type CandidatesMockSeed,
  resetCandidatesMock,
} from '../../server/reporting/candidates-mock.server';
import { setEaccIntakeMockLatency } from '../../server/reporting/eacc-mock.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import { type NcrMockSeed, resetNcrMock } from '../../server/reporting/ncr-mock.server';
import type { NationalReport } from '../../server/reporting/types';
import { NationalReportView } from './national-report-view';
import {
  type PatternCandidatesLoad,
  useEarlierAggregates,
  useNcrPatterns,
} from './notable-patterns';

type Props = ComponentProps<typeof NationalReportView>;

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));

const ANALYST = { subject: 'user-baraka-mutua', name: 'Baraka Mutua', roles: ['eacc-analyst'] };
const SUPERVISOR = {
  subject: 'user-nafula-wekesa',
  name: 'Nafula Wekesa',
  roles: ['eacc-supervisor'],
};

const client = (roles: readonly string[]) =>
  mockReportingClient(roles, { name: 'Baraka Mutua', subject: ANALYST.subject, tenant: 'eacc' });

const loadFromMock: PatternCandidatesLoad = (fy) =>
  loadPatternCandidates(client(['eacc-analyst']), fy);

/** The mock's report of a year: FY 2025/2026's alone, so an earlier year's is not built. */
const reportFromMock: NationalReportLoad = (fy) => loadNationalReport(client(['eacc-analyst']), fy);

async function pageOf(seed: NcrMockSeed) {
  setReportingMockLatency(0);
  setEaccIntakeMockLatency(0);
  // FY 2025/2026's reports are in.
  resetReportingMock('2026-10-03');
  resetNcrMock(seed, { pdfDelayMs: 0 });
  const page = await loadNationalReportPage(client(['eacc-analyst']), 2025);
  if (!page.ok) throw new Error('the mock did not load');
  return page;
}

interface Options {
  seed?: NcrMockSeed;
  candidates?: CandidatesMockSeed;
  load?: PatternCandidatesLoad;
  loadReport?: NationalReportLoad;
  viewer?: typeof ANALYST;
  edit?: (report: NationalReport) => NationalReport;
  page?: number;
}

async function renderPage({
  seed = 'draft',
  candidates = 'computed',
  load = loadFromMock,
  loadReport = reportFromMock,
  viewer = ANALYST,
  edit = (report) => report,
  page = 1,
}: Options = {}) {
  const loaded = await pageOf(seed);
  resetCandidatesMock(candidates);
  const report = loaded.data.report ? edit(loaded.data.report) : null;
  const result = { ok: true as const, data: { ...loaded.data, report } };
  const onPageChange = vi.fn();
  const onUnauthenticated = vi.fn();
  // Saved by the reporting mock, which answers as the service does: a new version, paragraphs
  // mapped from the text (citations dropped, #500).
  const saveNarrative = vi.fn<Props['saveNarrative']>((fy, narrative) =>
    saveNationalReportNarrative(client([...viewer.roles]), fy, narrative),
  );

  function Page() {
    const extensions = useNcrPatterns({
      fy: 2025,
      report,
      load,
      loadReport,
      page,
      onPageChange,
      onUnauthenticated,
    });
    return (
      <NationalReportView
        fy={2025}
        today="2026-10-03"
        onYearChange={vi.fn()}
        page={page}
        onPageChange={onPageChange}
        result={result}
        viewer={viewer}
        build={vi.fn()}
        saveNarrative={saveNarrative}
        approve={vi.fn()}
        pdfLink={vi.fn()}
        onUnauthenticated={onUnauthenticated}
        extensions={extensions}
      />
    );
  }

  render(
    <TooltipProvider>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </TooltipProvider>,
  );
  return { onPageChange, onUnauthenticated, saveNarrative };
}

const panel = () => screen.getByRole('region', { name: 'Notable patterns' });
const cards = () => within(panel()).queryAllByRole('article');

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  resetCandidatesMock('computed');
});

describe('Notable patterns panel', () => {
  it('shows the candidates as cards, six to a page, with how many there are', async () => {
    await renderPage();

    await waitFor(() => {
      expect(cards()).toHaveLength(6);
    });
    expect(within(panel()).getByText('9 notable patterns')).toBeDefined();
    const first = within(panel()).getByRole('article', {
      name: 'Rate change: Nairobi City County Public Service Board',
    });
    expect(first.textContent).toContain('34.4%');
    expect(first.textContent).toContain('from 15.2% in 2024/2025, 2.3 times');
    expect(
      within(panel()).getByRole('article', { name: 'Rate change: National' }).textContent,
    ).toContain('from 2.9% in 2024/2025, 2.1 times');
    expect(
      within(panel()).getByRole('article', {
        name: 'Repeatedly late: Teachers Service Commission',
      }).textContent,
    ).toContain('2023/2024, 2024/2025 and 2025/2026');

    fireEvent.click(within(panel()).getByRole('button', { name: 'Next page' }));

    expect(cards().map((card) => card.getAttribute('aria-label'))).toEqual([
      'Did not report: Kisumu County Public Service Board',
      'Did not report: Kisii County Public Service Board',
      'Did not report: Public Service Commission',
    ]);
  });

  it('sits between the per-Commission table and the narrative', async () => {
    await renderPage();

    const byCommission = screen.getByRole('region', { name: 'By Commission' });
    const narrative = screen.getByRole('region', { name: 'Narrative' });
    expect(
      byCommission.compareDocumentPosition(panel()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      panel().compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows card shapes while the candidates load', async () => {
    await renderPage({ load: () => new Promise(() => undefined) });

    expect(panel().getAttribute('aria-busy')).toBe('true');
    expect(cards()).toHaveLength(0);
    expect(within(panel()).queryByText(/notable patterns$/)).toBeNull();
  });

  it('says so when nothing crossed the thresholds', async () => {
    await renderPage({ candidates: 'none' });

    expect(await within(panel()).findByText('No notable patterns')).toBeDefined();
    expect(
      within(panel()).getByText('Nothing crossed the thresholds for FY 2025/2026.'),
    ).toBeDefined();
  });

  it('offers a retry, then says what it found and keeps focus in the panel', async () => {
    await renderPage({ candidates: 'error' });

    expect(await within(panel()).findByText('Notable patterns could not be loaded.')).toBeDefined();
    resetCandidatesMock('computed');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Retry' }));

    expect(document.activeElement).toBe(
      within(panel()).getByRole('heading', { name: 'Notable patterns' }),
    );
    await waitFor(() => {
      expect(cards()).toHaveLength(6);
    });
    expect(within(panel()).getByRole('status').textContent).toBe('9 notable patterns');
  });

  it('says when a retry failed again', async () => {
    await renderPage({ candidates: 'error' });

    fireEvent.click(await within(panel()).findByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(within(panel()).getByRole('status').textContent).toBe(
        'Notable patterns could not be loaded.',
      );
    });
  });

  it('is not there for a viewer the service refuses the candidates', async () => {
    await renderPage({ load: (fy) => loadPatternCandidates(client(['eacc-auditor']), fy) });

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Notable patterns' })).toBeNull();
    });
    expect(screen.getByRole('region', { name: 'Narrative' })).toBeDefined();
  });

  it('sends a viewer whose session ended to sign in', async () => {
    const { onUnauthenticated } = await renderPage({
      load: () => Promise.resolve({ ok: false, error: { kind: 'unauthenticated' } }),
    });

    await waitFor(() => {
      expect(onUnauthenticated).toHaveBeenCalled();
    });
  });

  it('shows the EACC supervisor the candidates with nothing to cite', async () => {
    await renderPage({ viewer: SUPERVISOR });

    await waitFor(() => {
      expect(cards()).toHaveLength(6);
    });
    expect(within(panel()).queryByRole('button', { name: /Cite in findings/ })).toBeNull();
  });
});

describe('Paragraph figures', () => {
  it('leaves nothing under a paragraph with no label or figure', async () => {
    await renderPage({ viewer: SUPERVISOR });

    const overview = screen.getByRole('group', { name: 'Overview' });
    const text = within(overview).getByText(/This report consolidates/);
    // The paragraph alone in its block: no empty row of labels and chips under it.
    expect(text.parentElement?.children).toHaveLength(1);
  });
});

describe('Cited in findings', () => {
  const citing = (report: NationalReport): NationalReport => ({
    ...report,
    narrativeParagraphs: [
      ...report.narrativeParagraphs,
      {
        id: '0199c000-0000-7000-8000-000000000001',
        section: 'findings',
        position: 2,
        text: 'The Teachers Service Commission reported late for the third year running.',
        aiDraft: false,
        aggregateRefs: [
          'fy2025.commission.tsc.reportedLate',
          'commission.tsc.reportedLate',
          'commission.nobody.filed',
          'national.commissionsLate',
        ],
        candidateIds: ['chronic-late-reporting:tsc:reportedLate'],
      },
    ],
  });

  it('marks a candidate the findings cite', async () => {
    await renderPage({ edit: citing });

    const card = await within(panel()).findByRole('article', {
      name: 'Repeatedly late: Teachers Service Commission',
    });
    expect(card.getAttribute('data-cited')).toBe('true');
    expect(card.textContent).toContain('Cited in findings');
  });

  it("shows a citing paragraph's figures, and a figure it cannot find", async () => {
    await renderPage({ edit: citing });

    const narrative = screen.getByRole('region', { name: 'Narrative' });
    expect(
      await within(narrative).findByRole('button', {
        name: 'Figure Teachers Service Commission reported late 2025/2026: Yes. Show in table',
      }),
    ).toBeDefined();
    expect(within(narrative).getByText('Figure not found')).toBeDefined();
    // The page labels the draft's AI paragraph once, beside its figure.
    expect(within(narrative).getAllByText('AI draft')).toHaveLength(1);
    expect(
      within(narrative).getByRole('button', {
        name: 'Figure Nairobi City County Public Service Board biennial filing rate 2025/2026: 62%. Show in table',
      }),
    ).toBeDefined();
  });

  it("shows a prior year's figure, and one with no row, as plain chips", async () => {
    await renderPage({ edit: citing });

    const narrative = screen.getByRole('region', { name: 'Narrative' });
    const prior = await within(narrative).findByText(
      'Teachers Service Commission reported late 2024/2025:',
      { exact: false },
    );
    expect(prior.closest('button')).toBeNull();
    const late = within(narrative).getByText('Commissions reported late 2025/2026:', {
      exact: false,
    });
    expect(late.closest('button')).toBeNull();
  });

  it("shows an earlier year's figure no candidate carries from that year's report", async () => {
    const earlier = (report: NationalReport): NationalReport => ({
      ...citing(report),
      narrativeParagraphs: [
        ...report.narrativeParagraphs,
        {
          id: '0199c000-0000-7000-8000-000000000002',
          section: 'overview',
          position: 9,
          text: 'Access requests fell on the year before.',
          aiDraft: true,
          aggregateRefs: ['fy2025.national.accessRequestsReceived'],
          candidateIds: [],
        },
      ],
    });
    const loadReport = vi.fn<NationalReportLoad>(async (fy) => {
      const thisYear = await reportFromMock(2025);
      if (!thisYear.ok || fy !== 2024) return reportFromMock(fy);
      const { aggregates } = thisYear.data;
      return {
        ok: true,
        data: {
          ...thisYear.data,
          aggregates: {
            ...aggregates,
            fy: 2024,
            national: {
              ...aggregates.national,
              accessRequests: { received: 41, granted: 40, declined: 1 },
            },
          },
        },
      };
    });
    await renderPage({ edit: earlier, loadReport });

    const narrative = screen.getByRole('region', { name: 'Narrative' });
    expect(
      await within(narrative).findByText('National access requests received 2024/2025:', {
        exact: false,
      }),
    ).toBeDefined();
    expect(within(narrative).getByText('41')).toBeDefined();
    // Asked once for the one earlier year the paragraphs cite.
    expect(loadReport.mock.calls).toEqual([[2024]]);
  });

  it("turns the table to a figure's Commission row and highlights it", async () => {
    const { onPageChange } = await renderPage({ edit: citing });

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Figure Teachers Service Commission reported late 2025/2026: Yes. Show in table',
      }),
    );

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('highlights a row on the page shown', async () => {
    await renderPage({ edit: citing });

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Figure Nairobi City County Public Service Board biennial filing rate 2025/2026: 62%. Show in table',
      }),
    );

    await waitFor(() => {
      expect(
        document.getElementById('ncr-row-cpsb047')?.hasAttribute('data-target-highlight'),
      ).toBe(true);
    });
  });
});

describe('Cite in findings', () => {
  it('appends a findings paragraph citing the figures, focuses it and says so', async () => {
    const { saveNarrative } = await renderPage();

    const card = await within(panel()).findByRole('article', {
      name: 'Repeatedly late: Teachers Service Commission',
    });
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Cite in findings: Repeatedly late, Teachers Service Commission',
      }),
    );

    const findings = screen.getByRole('group', { name: 'Findings' });
    const field = within(findings).getByRole('textbox', { name: 'Findings, paragraph 3' });
    expect((field as HTMLTextAreaElement).value).toBe(
      'Teachers Service Commission: 3 years reported late running (2023/2024, 2024/2025 and 2025/2026).',
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    expect(
      within(findings).getByRole('button', {
        name: 'Figure Teachers Service Commission reported late 2025/2026: Yes. Show in table',
      }),
    ).toBeDefined();
    expect(card.getAttribute('data-cited')).toBe('true');
    expect(
      within(card).getByRole('button', {
        name: 'Cited in findings: Repeatedly late, Teachers Service Commission',
      }),
    ).toBeDefined();
    expect(
      await screen.findByText('Cited in findings. Rewrite the paragraph in your words.'),
    ).toBeDefined();
    // Saved through the page's autosave, the cited text in the findings.
    fireEvent.blur(field);
    await waitFor(() => {
      expect(saveNarrative).toHaveBeenCalled();
    });
    expect(saveNarrative.mock.lastCall?.[1].findings).toContain(
      'Teachers Service Commission: 3 years reported late running',
    );
  });

  it('stays cited after the save answers, and a second press adds nothing', async () => {
    const { saveNarrative } = await renderPage();

    const card = await within(panel()).findByRole('article', {
      name: 'Repeatedly late: Teachers Service Commission',
    });
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Cite in findings: Repeatedly late, Teachers Service Commission',
      }),
    );
    const findings = screen.getByRole('group', { name: 'Findings' });
    fireEvent.blur(within(findings).getByRole('textbox', { name: 'Findings, paragraph 3' }));
    await waitFor(() => {
      expect(saveNarrative).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      // The service's answer: a new version whose paragraphs no longer carry the citation.
      expect(await saveNarrative.mock.results[0]?.value).toMatchObject({ ok: true });
    });

    expect(card.getAttribute('data-cited')).toBe('true');
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Cited in findings: Repeatedly late, Teachers Service Commission',
      }),
    );
    expect(within(findings).getAllByRole('textbox')).toHaveLength(3);
  });

  it('is not offered once the report is approved', async () => {
    await renderPage({ seed: 'approved' });

    await waitFor(() => {
      expect(cards()).toHaveLength(6);
    });
    expect(within(panel()).queryByRole('button', { name: /Cite in findings/ })).toBeNull();
  });
});

describe("Earlier years' reports", () => {
  /** FY 2025/2026's report citing FY 2024/2025's filing rate, as `version` of it. */
  async function citingEarlier(version: number): Promise<NationalReport> {
    const page = await pageOf('draft');
    const report = page.data.report;
    if (!report) throw new Error('the mock has no report');
    return {
      ...report,
      version,
      narrativeParagraphs: [
        {
          id: '0199c000-0000-7000-8000-000000000003',
          section: 'overview',
          position: 0,
          text: 'Filing rose on the year before.',
          aiDraft: true,
          aggregateRefs: ['fy2025.national.filingRate'],
          candidateIds: [],
        },
      ],
    };
  }

  const earlierOf = (report: NationalReport): NationalReport => ({
    ...report,
    aggregates: { ...report.aggregates, fy: 2024 },
  });

  it('reads a year whose read failed again when the report next changes, not before', async () => {
    const first = await citingEarlier(1);
    const loadReport = vi.fn<NationalReportLoad>();
    loadReport.mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } });
    loadReport.mockResolvedValue({ ok: true, data: earlierOf(first) });
    const { result, rerender } = renderHook(
      ({ report }: { report: NationalReport }) =>
        useEarlierAggregates({ fy: 2025, report, loadReport, onUnauthenticated: vi.fn() }),
      { initialProps: { report: first } },
    );

    await waitFor(() => {
      expect(loadReport).toHaveBeenCalledTimes(1);
    });
    await act(() => Promise.resolve());
    expect(result.current).toEqual([]);
    expect(loadReport).toHaveBeenCalledTimes(1);

    rerender({ report: await citingEarlier(2) });
    await waitFor(() => {
      expect(result.current.map(({ fy }) => fy)).toEqual([2024]);
    });
    expect(loadReport.mock.calls).toEqual([[2024], [2024]]);
  });

  it('does not ask again for a year the service will not give', async () => {
    const first = await citingEarlier(1);
    const loadReport = vi.fn<NationalReportLoad>().mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Not built yet', status: 404 },
      },
    });
    const { result, rerender } = renderHook(
      ({ report }: { report: NationalReport }) =>
        useEarlierAggregates({ fy: 2025, report, loadReport, onUnauthenticated: vi.fn() }),
      { initialProps: { report: first } },
    );
    await waitFor(() => {
      expect(loadReport).toHaveBeenCalledTimes(1);
    });
    await act(() => Promise.resolve());

    rerender({ report: await citingEarlier(2) });
    await act(() => Promise.resolve());
    expect(loadReport).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);
  });

  it('reads each year once and sends a viewer whose session ended to sign in, in strict mode', async () => {
    const report = await citingEarlier(1);
    const onUnauthenticated = vi.fn();
    const loadReport = vi
      .fn<NationalReportLoad>()
      .mockResolvedValue({ ok: false, error: { kind: 'unauthenticated' } });
    renderHook(() => useEarlierAggregates({ fy: 2025, report, loadReport, onUnauthenticated }), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    });
    expect(loadReport).toHaveBeenCalledTimes(1);
  });
});
