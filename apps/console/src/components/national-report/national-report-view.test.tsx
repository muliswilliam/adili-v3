// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type NationalReportPage,
  type NationalReportResult,
  loadNationalReportPage,
} from '../../server/national-report.server';
import { setEaccIntakeMockLatency } from '../../server/reporting/eacc-mock.server';
import {
  mockReportingClient,
  resetReportingMock as resetFormMMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import {
  type NcrMockSeed as ReportingMockSeed,
  resetNcrMock as resetReportingMock,
} from '../../server/reporting/ncr-mock.server';
import type { NationalReport } from '../../server/reporting/types';
import { appendParagraph } from './model';
import { NationalReportView } from './national-report-view';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const downloadFrom = vi.fn<(url: string) => void>();
vi.mock('../download', () => ({
  downloadFrom: (url: string) => {
    downloadFrom(url);
  },
}));

const ANALYST = { subject: 'user-baraka-mutua', name: 'Baraka Mutua', roles: ['eacc-analyst'] };
const SUPERVISOR = {
  subject: 'user-nafula-wekesa',
  name: 'Nafula Wekesa',
  roles: ['eacc-supervisor'],
};

/** The page as the reporting mock answers it for `seed`. */
async function pageOf(seed: ReportingMockSeed, fy = 2025) {
  setReportingMockLatency(0);
  setEaccIntakeMockLatency(0);
  resetFormMMock('2026-10-03');
  resetReportingMock(seed, { pdfDelayMs: 0 });
  const result = await loadNationalReportPage(
    mockReportingClient(['eacc-analyst'], { name: 'Baraka Mutua', tenant: 'eacc' }),
    fy,
  );
  if (!result.ok) throw new Error('the mock did not load');
  return result;
}

function reportOf(page: NationalReportResult<NationalReportPage>): NationalReport {
  if (!page.ok || !page.data.report) throw new Error('expected a report');
  return page.data.report;
}

type Props = ComponentProps<typeof NationalReportView>;

function renderView(props: Partial<Props> & Pick<Props, 'result'>) {
  const all: Props = {
    fy: 2025,
    today: '2026-10-03',
    tabs: <nav aria-label="Compliance reports sections" />,
    page: 1,
    viewer: ANALYST,
    onYearChange: vi.fn(),
    onPageChange: vi.fn(),
    build: vi.fn(),
    saveNarrative: vi.fn(() => Promise.resolve({ ok: true } as never)),
    approve: vi.fn(),
    pdfLink: vi.fn(),
    onUnauthenticated: vi.fn(),
    ...props,
  };
  const view = (next: Props) => (
    <TooltipProvider>
      <ToastProvider>
        <NationalReportView {...next} />
      </ToastProvider>
    </TooltipProvider>
  );
  const { rerender } = render(view(all));
  return Object.assign(all, {
    rerender: (changes: Partial<Props>) => {
      rerender(view({ ...all, ...changes }));
    },
  });
}

beforeAll(() => {
  // Radix Select's pointer and scrolling calls, which jsdom lacks.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  invalidate.mockReset();
  downloadFrom.mockReset();
});

describe('S15 national report: loading and failures', () => {
  it('shows the page busy while the report loads', () => {
    renderView({ result: null });

    expect(screen.getByRole('heading', { level: 1, name: 'Compliance reports' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Compliance reports sections' })).toBeDefined();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('tells anyone outside EACC the page is not theirs (403)', () => {
    renderView({
      result: {
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
        },
      },
    });

    expect(
      screen.getByText(
        'Only EACC analysts and supervisors work on the national consolidated report.',
      ),
    ).toBeDefined();
  });

  it('offers a retry when the report could not be loaded', () => {
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });

    expect(screen.getByText('The national report could not be loaded')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('switches the financial year', async () => {
    const props = renderView({ result: await pageOf('not-built') });

    expect(screen.getByRole('combobox', { name: 'Financial year' }).textContent).toContain(
      'FY 2025/2026 (due 31 Jul 2026)',
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Financial year' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'FY 2026/2027 (current)' }));
    expect(props.onYearChange).toHaveBeenCalledWith(2026);
  });
});

describe('S15 national report: before it is built', () => {
  it('says when nobody has reported for the year yet', async () => {
    renderView({ fy: 2026, result: await pageOf('not-built', 2026) });

    expect(screen.getByText('No reports for FY 2026/2027 yet')).toBeDefined();
    expect(screen.getByText('Form M reports are due 31 Jul 2027.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Build from/ })).toBeNull();
  });

  it('lets an analyst build it from the submitted reports', async () => {
    const built = await pageOf('draft');
    let finish: (result: NationalReportResult<NationalReport>) => void = () => undefined;
    const build = vi.fn(
      () =>
        new Promise<NationalReportResult<NationalReport>>((resolve) => {
          finish = resolve;
        }),
    );
    renderView({ result: await pageOf('not-built'), build });

    expect(screen.getByText('National report not built yet')).toBeDefined();
    expect(
      screen.getByText('11 Commissions reported, 4 have not. You can rebuild later.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Build from 11 submitted reports' }));

    expect(build).toHaveBeenCalledWith(2025);
    expect(screen.getByText('Building from 11 submitted reports…')).toBeDefined();
    expect(screen.queryByText('Your narrative is kept.')).toBeNull();
    await act(async () => {
      finish({ ok: true, data: reportOf(built) });
      await Promise.resolve();
    });
    expect(await screen.findByText('Built from 11 reports. Narrative kept.')).toBeDefined();
    expect(invalidate).toHaveBeenCalled();
  });

  it('says why a build was refused', async () => {
    const build = vi.fn(() =>
      Promise.resolve<NationalReportResult<NationalReport>>({
        ok: false,
        error: {
          kind: 'problem',
          problem: {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            code: 'no-submitted-reports',
          },
        },
      }),
    );
    renderView({ result: await pageOf('not-built'), build });

    fireEvent.click(screen.getByRole('button', { name: 'Build from 11 submitted reports' }));

    expect(
      await screen.findByText('No Commission has submitted its report for the year yet.'),
    ).toBeDefined();
  });

  it('leaves building to the analysts: an EACC supervisor sees no Build button', async () => {
    renderView({ result: await pageOf('not-built'), viewer: SUPERVISOR });

    expect(screen.getByText('National report not built yet')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Build from/ })).toBeNull();
  });
});

describe('S11 S15 national report: the draft', () => {
  it('shows who built it, from how many reports, and the national totals', async () => {
    renderView({ result: await pageOf('draft') });

    expect(screen.getByRole('heading', { name: 'Built from 11 reports' })).toBeDefined();
    expect(screen.getByText(/Author Brian Otieno/)).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();
    const totals = screen.getByRole('table', { name: 'National totals per Form M section' });
    const initial = within(totals).getByRole('row', { name: /1\. Initial declarations/ });
    expect(initial.textContent).toContain('20,442');
    expect(initial.textContent).toContain('19,607');
    expect(initial.textContent).toContain('835');
    expect(initial.textContent).toContain('95.9%');
    expect(within(totals).getByRole('row', { name: /All sections/ })).toBeDefined();
  });

  it('lists every Commission by name with its status and rates, ten to a page', async () => {
    const props = renderView({ result: await pageOf('draft') });

    const table = screen.getByRole('table', { name: 'Declared rates per Commission' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toMatch(/^Bungoma County Public Service Board/);
    expect(screen.getByText('1-10 of 15')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it("shows a page's rates per section", async () => {
    renderView({ result: await pageOf('draft'), page: 2 });

    const table = screen.getByRole('table', { name: 'Declared rates per Commission' });
    const tsc = within(table).getByRole('row', { name: /Teachers Service Commission/ });
    expect(within(tsc).getByText('Reported late')).toBeDefined();
    expect(tsc.textContent).toContain('95.2%');
    expect(screen.getByText('11-15 of 15')).toBeDefined();
  });

  it('shows a Commission that has not reported without figures', async () => {
    renderView({ result: await pageOf('draft') });

    const table = screen.getByRole('table', { name: 'Declared rates per Commission' });
    const kisii = within(table).getByRole('row', { name: /Kisii County Public Service Board/ });
    expect(within(kisii).getByText('Not reported')).toBeDefined();
    expect(within(kisii).getAllByText('No report')).toHaveLength(3);
  });

  it('lets the analyst rebuild, and says a rebuild keeps the narrative', async () => {
    const page = await pageOf('stale');
    const build = vi.fn(() => Promise.resolve({ ok: true as const, data: reportOf(page) }));
    renderView({ result: page, build });

    expect(screen.getByText('1 new report since this build.')).toBeDefined();
    expect(screen.getByText('Rebuilding keeps the narrative.')).toBeDefined();
    const [, bannerRebuild] = screen.getAllByRole('button', { name: 'Rebuild' });
    if (!bannerRebuild) throw new Error('expected the banner to offer a rebuild');
    fireEvent.click(bannerRebuild);
    expect(build).toHaveBeenCalledWith(2025);
  });

  it('rebuilds in place, keeping what the analyst is typing', async () => {
    const page = await pageOf('stale');
    let finish: (result: NationalReportResult<NationalReport>) => void = () => undefined;
    const build = vi.fn(
      () =>
        new Promise<NationalReportResult<NationalReport>>((resolve) => {
          finish = resolve;
        }),
    );
    renderView({ result: page, build });
    fireEvent.change(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' }), {
      target: { value: 'Chase the two.' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Rebuild' })[0] ?? document.body);

    expect(screen.getAllByRole('button', { name: 'Rebuilding…' })[0]).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' })).toHaveProperty(
      'value',
      'Chase the two.',
    );
    await act(async () => {
      finish({ ok: true, data: reportOf(page) });
      await Promise.resolve();
    });
    expect(await screen.findByText('Built from 10 reports. Narrative kept.')).toBeDefined();
  });

  it('says nothing failed when a rebuild finds the report approved meanwhile (409)', async () => {
    const build = vi.fn(() =>
      Promise.resolve<NationalReportResult<NationalReport>>({
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Conflict', status: 409, code: 'ncr-approved' },
        },
      }),
    );
    renderView({ result: await pageOf('draft'), build });

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(screen.queryByText('The report could not be built. Try again.')).toBeNull();
  });

  it("autosaves the analyst's narrative, each section as text", async () => {
    const page = await pageOf('draft');
    const saveNarrative = vi.fn(() => Promise.resolve({ ok: true as const, data: reportOf(page) }));
    renderView({ result: page, saveNarrative });

    const field = screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' });
    fireEvent.change(field, { target: { value: 'Chase the three.' } });
    fireEvent.blur(field);

    await waitFor(() => {
      expect(saveNarrative).toHaveBeenCalled();
    });
    const [fy, narrative] = saveNarrative.mock.calls[0] as unknown as [
      number,
      Record<string, string>,
    ];
    expect(fy).toBe(2025);
    expect(narrative.recommendations).toBe('Chase the three.');
    expect(narrative.overview).toMatch(/^This report consolidates/);
    expect(narrative.findings?.split('\n\n')).toHaveLength(2);
  });

  it('keeps the approve button from an analyst, saying who approves', async () => {
    renderView({ result: await pageOf('draft') });

    expect(screen.getByText('Only an EACC supervisor can approve')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true);
  });

  it('shows the narrative read only to an EACC supervisor, an AI-drafted paragraph labelled', async () => {
    renderView({ result: await pageOf('draft'), viewer: SUPERVISOR });

    expect(screen.getByText('Written by the analyst')).toBeDefined();
    expect(screen.getAllByRole('img', { name: /^AI draft\./ })).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull();
  });

  it('keeps the approve button from the author', async () => {
    const page = await pageOf('draft');
    renderView({
      result: page,
      viewer: { subject: 'mock-brian-otieno', name: 'Brian Otieno', roles: ['eacc-supervisor'] },
    });

    expect(screen.getByText('The author cannot approve')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true);
  });
});

describe('S11 S15 national report: approval', () => {
  it('lets an EACC supervisor who did not write it approve, stating what follows', async () => {
    const page = await pageOf('draft');
    const approved = await pageOf('approved');
    const approve = vi.fn(() => Promise.resolve({ ok: true as const, data: reportOf(approved) }));
    renderView({ result: page, viewer: SUPERVISOR, approve });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve the national report?' });
    expect(
      within(dialog).getByText(/It receives its NCR reference and the Restricted PDF/),
    ).toBeDefined();
    expect(within(dialog).getByText('Brian Otieno')).toBeDefined();
    expect(within(dialog).getByText('Nafula Wekesa')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(approve).toHaveBeenCalledWith(2025, expect.stringMatching(/^[0-9a-f-]{36}$/));
    });
    expect(await screen.findByText('Approved as NCR-EACC-2026-0000001-V.')).toBeDefined();
    expect(invalidate).toHaveBeenCalled();
  });

  it('says why a supervisor who wrote part of it cannot approve, and retries with the same key', async () => {
    const approve = vi.fn(() =>
      Promise.resolve<NationalReportResult<NationalReport>>({
        ok: false,
        error: {
          kind: 'problem',
          problem: {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            code: 'separation-of-duties',
          },
        },
      }),
    );
    renderView({ result: await pageOf('draft'), viewer: SUPERVISOR, approve });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(
      await within(dialog).findByText(
        'You built or wrote part of this report, so another EACC supervisor must approve it.',
      ),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(approve).toHaveBeenCalledTimes(2);
    });
    const keys = (approve.mock.calls as unknown as [number, string][]).map(([, key]) => key);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows the approved report with its reference and PDF, the narrative frozen', async () => {
    const page = await pageOf('approved');
    const pdfLink = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { downloadUrl: 'https://files.test/ncr.pdf', expiresAt: '2026-10-03T10:05:00Z' },
      }),
    );
    renderView({ result: page, pdfLink });

    expect(screen.getByText('Approved')).toBeDefined();
    expect(screen.getByText('NCR-EACC-2026-0000001-V')).toBeDefined();
    expect(screen.getByText(/Approved by Esther Chebet/)).toBeDefined();
    expect(screen.getByText('Frozen at approval')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => {
      expect(downloadFrom).toHaveBeenCalledWith('https://files.test/ncr.pdf');
    });
    expect(pdfLink).toHaveBeenCalledWith(reportOf(page).documentId);
  });

  it('offers to check again once the PDF has been waited on for a while', async () => {
    const page = await pageOf('approved');
    const report = reportOf(page);
    vi.useFakeTimers();
    try {
      renderView({
        result: { ok: true, data: { ...page.data, report: { ...report, documentId: null } } },
      });

      act(() => {
        vi.advanceTimersByTime(31_000);
      });

      expect(screen.getByText('The PDF is taking longer than usual.')).toBeDefined();
      invalidate.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      expect(invalidate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the PDF is being prepared until it is issued', async () => {
    const page = await pageOf('approved');
    const report = reportOf(page);
    renderView({
      result: { ok: true, data: { ...page.data, report: { ...report, documentId: null } } },
    });

    expect(screen.getByRole('button', { name: 'Preparing PDF…' })).toHaveProperty('disabled', true);
  });
});

describe('seams for spec 09b', () => {
  it('places the notable patterns panel before the narrative and the draft menu in its header', async () => {
    renderView({
      result: await pageOf('draft'),
      extensions: {
        patterns: () => <section aria-label="Notable patterns" />,
        narrativeActions: () => <button type="button">Draft narrative</button>,
      },
    });

    const patterns = screen.getByRole('region', { name: 'Notable patterns' });
    const narrative = screen.getByRole('region', { name: 'Narrative' });
    expect(
      patterns.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(narrative).getByRole('button', { name: 'Draft narrative' })).toBeDefined();
  });
  it('lets a panel insert into the narrative being edited, saved like typing (#331 Cite in findings)', async () => {
    const page = await pageOf('draft');
    const saveNarrative = vi.fn(() => Promise.resolve({ ok: true as const, data: reportOf(page) }));
    renderView({
      result: page,
      saveNarrative,
      extensions: {
        patterns: ({ canEdit, editNarrative }) => (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => {
              editNarrative((value) =>
                appendParagraph(value, 'findings', {
                  text: 'Nairobi City reports a biennial rate of 62%.',
                  aggregateRefs: ['commission.cpsb047.rate.biennial'],
                  candidateIds: ['threshold-breach:cpsb047'],
                }),
              );
            }}
          >
            Cite in findings
          </button>
        ),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cite in findings' }));

    expect(screen.getByRole('textbox', { name: 'Findings, paragraph 3' })).toHaveProperty(
      'value',
      'Nairobi City reports a biennial rate of 62%.',
    );
    await waitFor(
      () => {
        expect(saveNarrative).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    const [, narrative] = saveNarrative.mock.calls[0] as unknown as [
      number,
      Record<string, string>,
    ];
    expect(narrative.findings?.split('\n\n').at(-1)).toBe(
      'Nairobi City reports a biennial rate of 62%.',
    );
  });

  it('takes the report a panel got back as the narrative being edited (#341 drafts)', async () => {
    const page = await pageOf('draft');
    const report = reportOf(page);
    const drafted: NationalReport = {
      ...report,
      version: report.version + 1,
      narrativeParagraphs: [
        ...report.narrativeParagraphs,
        {
          id: '0199d000-0000-7000-8000-000000000001',
          section: 'recommendations',
          position: 0,
          text: 'Chase the boards that did not report.',
          aiDraft: true,
          aggregateRefs: [],
          candidateIds: [],
        },
      ],
    };
    renderView({
      result: page,
      extensions: {
        narrativeActions: ({ adoptReport }) => (
          <button
            type="button"
            onClick={() => {
              adoptReport(drafted);
            }}
          >
            Draft narrative
          </button>
        ),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Draft narrative' }));

    const field = screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' });
    expect(field).toHaveProperty('value', 'Chase the boards that did not report.');
    expect(field.getAttribute('data-ai-draft')).toBe('true');
  });

  it('resets the narrative when the report changes on the server, keeping edits not saved yet', async () => {
    const page = await pageOf('draft');
    const report = reportOf(page);
    const view = renderView({ result: page });
    const changed: NationalReport = {
      ...report,
      version: report.version + 2,
      narrativeParagraphs: report.narrativeParagraphs.filter((each) => each.section !== 'findings'),
    };

    view.rerender({ result: { ok: true, data: { ...page.data, report: changed } } });

    expect(screen.getByRole('textbox', { name: 'Findings, paragraph 1' })).toHaveProperty(
      'value',
      '',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Findings, paragraph 1' }), {
      target: { value: 'Typed, not saved yet.' },
    });
    view.rerender({
      result: {
        ok: true,
        data: { ...page.data, report: { ...changed, version: changed.version + 1 } },
      },
    });
    expect(screen.getByRole('textbox', { name: 'Findings, paragraph 1' })).toHaveProperty(
      'value',
      'Typed, not saved yet.',
    );
  });

  it('keeps text the service refused when a newer version arrives, so it is not lost', async () => {
    const page = await pageOf('draft');
    const report = reportOf(page);
    const saveNarrative = vi.fn(() =>
      Promise.resolve<NationalReportResult<NationalReport>>({
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Bad Request', status: 400 },
        },
      }),
    );
    const view = renderView({ result: page, saveNarrative });
    const field = screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' });
    fireEvent.change(field, { target: { value: 'Refused text.' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(saveNarrative).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('Could not save')).toBeDefined();
    });

    view.rerender({
      result: {
        ok: true,
        data: { ...page.data, report: { ...report, version: report.version + 5 } },
      },
    });

    expect(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' })).toHaveProperty(
      'value',
      'Refused text.',
    );
  });

  it('shows the server narrative, frozen, once the report is approved meanwhile', async () => {
    const page = await pageOf('draft');
    const report = reportOf(page);
    const approved = reportOf(await pageOf('approved'));
    const saveNarrative = vi.fn(() =>
      Promise.resolve<NationalReportResult<NationalReport>>({
        ok: false,
        error: {
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Conflict', status: 409, code: 'ncr-approved' },
        },
      }),
    );
    const view = renderView({ result: page, saveNarrative });
    const field = screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' });
    fireEvent.change(field, { target: { value: 'Typed as it was approved.' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(saveNarrative).toHaveBeenCalled();
    });

    view.rerender({
      result: {
        ok: true,
        data: { ...page.data, report: { ...approved, id: report.id, version: report.version + 1 } },
      },
    });

    expect(screen.getByText('Frozen at approval')).toBeDefined();
    expect(
      screen.getByText('Commissions that did not report should do so within 30 days.'),
    ).toBeDefined();
    expect(screen.queryByText('Typed as it was approved.')).toBeNull();
    expect(screen.queryByText('Could not save')).toBeNull();
  });

  it('keeps the AI-draft label when a panel adds its own paragraph line', async () => {
    renderView({
      result: await pageOf('draft'),
      extensions: {
        paragraphMeta: (paragraph) => (paragraph.aiDraft ? <span>1 figure cited</span> : null),
      },
    });

    expect(screen.getAllByRole('img', { name: /^AI draft\./ })).toHaveLength(1);
    expect(screen.getByText('1 figure cited')).toBeDefined();
  });
});
