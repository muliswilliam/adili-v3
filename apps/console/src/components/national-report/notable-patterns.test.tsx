// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNationalReportPage } from '../../server/national-report.server';
import { loadPatternCandidates } from '../../server/pattern-candidates.server';
import {
  type CandidatesMockSeed,
  resetCandidatesMock,
} from '../../server/reporting/candidates-mock.server';
import { mockReportingClient } from '../../server/reporting/mock.server';
import { type NcrMockSeed, resetNcrMock } from '../../server/reporting/ncr-mock.server';
import type { NationalReport } from '../../server/reporting/types';
import { NationalReportView } from './national-report-view';
import { type PatternCandidatesLoad, useNcrPatterns } from './notable-patterns';

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

async function pageOf(seed: NcrMockSeed) {
  resetNcrMock(seed, { pdfDelayMs: 0 });
  const page = await loadNationalReportPage(client(['eacc-analyst']), 2025);
  if (!page.ok) throw new Error('the mock did not load');
  return page;
}

interface Options {
  seed?: NcrMockSeed;
  candidates?: CandidatesMockSeed;
  load?: PatternCandidatesLoad;
  viewer?: typeof ANALYST;
  edit?: (report: NationalReport) => NationalReport;
  page?: number;
}

async function renderPage({
  seed = 'draft',
  candidates = 'computed',
  load = loadFromMock,
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

  function Page() {
    const extensions = useNcrPatterns({
      fy: 2025,
      report,
      load,
      page,
      onPageChange,
      onUnauthenticated,
    });
    return (
      <NationalReportView
        fy={2025}
        years={[2026, 2025]}
        onYearChange={vi.fn()}
        page={page}
        onPageChange={onPageChange}
        result={result}
        viewer={viewer}
        build={vi.fn()}
        saveNarrative={vi.fn()}
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
  return { onPageChange, onUnauthenticated };
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
    expect(within(panel()).getByLabelText('10 patterns').textContent).toBe('10');
    const first = within(panel()).getByRole('article', {
      name: 'Rate change: Nairobi City County Public Service Board',
    });
    expect(first.textContent).toContain('34.4%');
    expect(first.textContent).toContain('from 15.2% in 2024/2025, 2.3 times');
    expect(
      within(panel()).getByRole('article', {
        name: 'Repeatedly late: Teachers Service Commission',
      }).textContent,
    ).toContain('2023/2024, 2024/2025 and 2025/2026');

    fireEvent.click(within(panel()).getByRole('button', { name: 'Next page' }));

    expect(cards().map((card) => card.getAttribute('aria-label'))).toEqual([
      'Size-band outlier: Nairobi City County Public Service Board',
      'Did not report: Mandera County Public Service Board',
      'Did not report: Kwale County Public Service Board',
      'Did not report: Turkana County Public Service Board',
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
    expect(within(panel()).queryByLabelText(/^\d+ patterns$/)).toBeNull();
  });

  it('says so when nothing crossed the thresholds', async () => {
    await renderPage({ candidates: 'none' });

    expect(await within(panel()).findByText('No notable patterns')).toBeDefined();
    expect(
      within(panel()).getByText('Nothing crossed the thresholds for FY 2025/2026.'),
    ).toBeDefined();
  });

  it('offers a retry when the candidates could not be loaded', async () => {
    await renderPage({ candidates: 'error' });

    expect(await within(panel()).findByText('Patterns could not be loaded.')).toBeDefined();
    resetCandidatesMock('computed');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(cards()).toHaveLength(6);
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
        name: 'Figure Teachers Service Commission reported late 2024/2025: Yes. Show in table',
      }),
    ).toBeDefined();
    expect(within(narrative).getByText('Figure not found')).toBeDefined();
    // The draft's AI paragraph keeps its label beside its figure.
    expect(within(narrative).getByText('AI draft')).toBeDefined();
    expect(
      within(narrative).getByRole('button', {
        name: 'Figure Nairobi City County Public Service Board biennial filing rate 2025/2026: 62%. Show in table',
      }),
    ).toBeDefined();
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
        document.getElementById('ncr-row-cpsbnairobicity')?.hasAttribute('data-target-highlight'),
      ).toBe(true);
    });
  });
});
