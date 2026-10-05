// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  draftNationalReportNarrative,
  loadNationalReport,
  loadNationalReportPage,
  saveNationalReportNarrative,
} from '../../server/national-report.server';
import { loadPatternCandidates } from '../../server/pattern-candidates.server';
import { resetCandidatesMock } from '../../server/reporting/candidates-mock.server';
import { setEaccIntakeMockLatency } from '../../server/reporting/eacc-mock.server';
import {
  mockReportingClient,
  resetReportingMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import {
  type NarrativeDraftMockSeed,
  resetNarrativeDraftMock,
} from '../../server/reporting/narrative-draft-mock.server';
import { type NcrMockSeed, resetNcrMock } from '../../server/reporting/ncr-mock.server';
import { NationalReportView } from './national-report-view';
import { type NarrativeDraftAsk, useNcrNarrativeDrafting } from './narrative-drafting';
import { useNcrPatterns } from './notable-patterns';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const ANALYST = { subject: 'user-baraka-mutua', name: 'Baraka Mutua', roles: ['eacc-analyst'] };
const SUPERVISOR = {
  subject: 'user-nafula-wekesa',
  name: 'Nafula Wekesa',
  roles: ['eacc-supervisor'],
};

const client = () =>
  mockReportingClient(['eacc-analyst'], {
    name: ANALYST.name,
    subject: ANALYST.subject,
    tenant: 'eacc',
  });

const draftFromMock: NarrativeDraftAsk = (fy, request, key) =>
  draftNationalReportNarrative(client(), fy, request, key);

interface Options {
  /** Keep the mocks as the test left them. */
  keep?: boolean;
  seed?: NcrMockSeed;
  narrative?: NarrativeDraftMockSeed;
  viewer?: typeof ANALYST;
  draft?: NarrativeDraftAsk;
}

async function renderPage({
  keep = false,
  seed = 'draft',
  narrative = 'inserted',
  viewer = ANALYST,
  draft = draftFromMock,
}: Options = {}) {
  if (!keep) {
    setReportingMockLatency(0);
    setEaccIntakeMockLatency(0);
    resetReportingMock('2026-10-03');
    resetNcrMock(seed, { pdfDelayMs: 0 });
    resetCandidatesMock('computed');
    resetNarrativeDraftMock(narrative, { readyAfterMs: 0 });
  }
  const page = await loadNationalReportPage(client(), 2025);
  if (!page.ok) throw new Error('the mock did not load');
  const result = page;
  const onUnauthenticated = vi.fn();
  const ask = vi.fn(draft);

  function Page() {
    const report = result.data.report;
    const patterns = useNcrPatterns({
      fy: 2025,
      report,
      load: (fy) => loadPatternCandidates(client(), fy),
      page: 1,
      onPageChange: vi.fn(),
      onUnauthenticated,
    });
    const drafting = useNcrNarrativeDrafting({
      fy: 2025,
      report,
      draft: ask,
      load: (fy) => loadNationalReport(client(), fy),
      onUnauthenticated,
      figures: patterns.paragraphMeta,
      pollMs: 5,
    });
    return (
      <NationalReportView
        fy={2025}
        today="2026-10-03"
        onYearChange={vi.fn()}
        page={1}
        onPageChange={vi.fn()}
        result={result}
        viewer={viewer}
        build={vi.fn()}
        saveNarrative={(fy, text) => saveNationalReportNarrative(client(), fy, text)}
        approve={vi.fn()}
        pdfLink={vi.fn()}
        onUnauthenticated={onUnauthenticated}
        extensions={{ ...patterns, ...drafting }}
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
  return { ask, onUnauthenticated };
}

const narrative = () => screen.getByRole('region', { name: 'Narrative' });
const sectionOf = (name: string) => within(narrative()).getByRole('group', { name });
const menuButton = () => within(narrative()).getByRole('button', { name: 'Draft narrative' });

function pick(item: string) {
  fireEvent.keyDown(menuButton(), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

const aiLabels = (section: string) =>
  within(sectionOf(section)).queryAllByRole('img', { name: /^AI draft\./ });

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  invalidate.mockReset();
});

describe('Draft narrative', () => {
  it('offers the analyst a menu of all sections or one', async () => {
    await renderPage();

    fireEvent.keyDown(menuButton(), { key: 'Enter' });

    expect(screen.getAllByRole('menuitem').map((each) => each.textContent)).toEqual([
      'All sections',
      'Overview',
      'Findings',
      'Recommendations',
    ]);
  });

  it('is not offered to the supervisor, nor once the report is approved', async () => {
    await renderPage({ viewer: SUPERVISOR });
    expect(within(narrative()).queryByRole('button', { name: 'Draft narrative' })).toBeNull();
  });

  it('is not offered once the report is approved', async () => {
    await renderPage({ seed: 'approved' });
    expect(within(narrative()).queryByRole('button', { name: 'Draft narrative' })).toBeNull();
  });

  it('drafts an empty section straight away: drafting, then AI-draft paragraphs citing figures', async () => {
    let finish: () => void = () => undefined;
    const { ask } = await renderPage({
      draft: (fy, request, key) =>
        new Promise((resolve) => {
          finish = () => {
            resolve(draftFromMock(fy, request, key));
          };
        }),
    });

    pick('Recommendations');

    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith(
        2025,
        { section: 'recommendations', replaceAll: false },
        expect.any(String),
      );
    });
    // The request can go out before the drafting state renders: wait for it.
    const button = await within(narrative()).findByRole('button', { name: 'Drafting…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await waitFor(() => {
      expect(within(sectionOf('Recommendations')).getByRole('status').textContent).toBe(
        'Drafting recommendations…',
      );
    });
    // Only the section asked for is being drafted.
    expect(within(sectionOf('Overview')).getAllByRole('textbox')).toHaveLength(1);

    finish();

    await waitFor(() => {
      expect(aiLabels('Recommendations')).toHaveLength(2);
    });
    const recommendations = sectionOf('Recommendations');
    expect(
      within(recommendations).getByRole<HTMLTextAreaElement>('textbox', {
        name: 'Recommendations, paragraph 1',
      }).value,
    ).toContain('EACC should follow up with each of the 4 Commissions that did not report');
    // Its figure, as a chip: 4 Commissions did not report.
    expect(within(recommendations).getAllByText(/Commissions not reported/).length).toBeGreaterThan(
      0,
    );
    expect(
      await screen.findByText('Drafted recommendations: 2 paragraphs. Review each one.'),
    ).toBeDefined();
    expect(menuButton()).toBeDefined();
  });

  it('asks before redrafting a section with text, replacing only AI-draft paragraphs by default', async () => {
    const { ask } = await renderPage();

    pick('Findings');

    const dialog = await screen.findByRole('dialog', { name: 'Redraft findings?' });
    const aiOnly = within(dialog).getByRole('radio', { name: 'Replace only AI-draft paragraphs' });
    expect((aiOnly as HTMLInputElement).checked).toBe(true);
    expect(dialog.textContent).toContain('Keeps 1 paragraph you wrote or edited.');
    expect(dialog.textContent).toContain('Removes all 2 paragraphs, including your edits.');
    expect(ask).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Redraft' }));

    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith(
        2025,
        { section: 'findings', replaceAll: false },
        expect.any(String),
      );
    });
    await waitFor(() => {
      expect(aiLabels('Findings').length).toBeGreaterThan(1);
    });
    // The analyst's own finding is kept, first.
    expect(
      within(sectionOf('Findings')).getByRole<HTMLTextAreaElement>('textbox', {
        name: 'Findings, paragraph 1',
      }).value,
    ).toContain('Eleven of fifteen Commissions reported');
  });

  it('replaces the whole section when the analyst chooses it', async () => {
    const { ask } = await renderPage();

    pick('All sections');
    const dialog = await screen.findByRole('dialog', { name: 'Redraft all sections?' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Replace every section' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Redraft' }));

    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith(
        2025,
        { section: 'all', replaceAll: true },
        expect.any(String),
      );
    });
    await waitFor(() => {
      expect(aiLabels('Overview')).toHaveLength(2);
    });
    expect(within(sectionOf('Overview')).getAllByRole('textbox')).toHaveLength(2);
  });

  it('saves edits not saved yet before asking, so the draft keeps them, and holds the editor meanwhile', async () => {
    const { ask } = await renderPage();
    const findings = sectionOf('Findings');
    const edited = 'The Nairobi City board explained its biennial rate.';
    fireEvent.change(within(findings).getByRole('textbox', { name: 'Findings, paragraph 2' }), {
      target: { value: edited },
    });

    pick('Recommendations');

    // The draft waits for the save; the paragraphs cannot change meanwhile.
    await waitFor(() => {
      expect(
        within(findings)
          .getByRole('textbox', { name: 'Findings, paragraph 2' })
          .hasAttribute('readonly'),
      ).toBe(true);
    });
    expect(ask).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(ask).toHaveBeenCalled();
      },
      { timeout: 4000 },
    );
    await waitFor(() => {
      expect(aiLabels('Recommendations')).toHaveLength(2);
    });
    const kept = within(sectionOf('Findings')).getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Findings, paragraph 2',
    });
    expect(kept.value).toBe(edited);
    expect(kept.hasAttribute('readonly')).toBe(false);
  });

  it('labels an AI-draft paragraph Edited once the analyst changes it', async () => {
    await renderPage();
    const findings = sectionOf('Findings');
    expect(aiLabels('Findings')).toHaveLength(1);
    const drafted = within(findings).getByRole('textbox', { name: 'Findings, paragraph 2' });

    fireEvent.change(drafted, { target: { value: 'The Nairobi City board explained its rate.' } });

    expect(aiLabels('Findings')).toHaveLength(0);
    expect(within(findings).getByRole('img', { name: /^Edited\./ })).toBeDefined();
  });

  it('says a draft that failed validation was discarded, and tries again', async () => {
    await renderPage({ narrative: 'validation' });

    pick('Recommendations');

    const message = 'The draft referenced a figure that is not in the table and was discarded.';
    const alert = await within(narrative()).findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(screen.getAllByText(message).length).toBeGreaterThan(1);
    expect(aiLabels('Recommendations')).toHaveLength(0);

    resetNarrativeDraftMock('inserted');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(aiLabels('Recommendations')).toHaveLength(2);
    });
    expect(within(narrative()).queryByRole('alert')).toBeNull();
  });

  it('says when the AI service did not respond, and the error can be dismissed', async () => {
    await renderPage({ narrative: 'failed' });

    pick('Recommendations');

    const alert = await within(narrative()).findByRole('alert');
    expect(alert.textContent).toContain(
      'The AI service did not respond. Nothing was changed. Try again, or write the narrative yourself.',
    );
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(within(narrative()).queryByRole('alert')).toBeNull();
  });

  it('says why the AI service failed the draft when it says so', async () => {
    await renderPage({ narrative: 'failed' });
    resetNarrativeDraftMock('failed', { failureReason: 'budget' });

    pick('Recommendations');

    const alert = await within(narrative()).findByRole('alert');
    expect(alert.textContent).toContain(
      "This month's AI budget is used up. Nothing was changed. Write the narrative yourself.",
    );
    expect(aiLabels('Recommendations')).toHaveLength(0);
  });

  it('waits for a draft still being written, then inserts it', async () => {
    await renderPage({ narrative: 'slow' });

    pick('Recommendations');

    await waitFor(() => {
      expect(aiLabels('Recommendations')).toHaveLength(2);
    });
    expect(
      await screen.findByText('Drafted recommendations: 2 paragraphs. Review each one.'),
    ).toBeDefined();
  });

  it('says a draft discarded after it was written failed validation', async () => {
    await renderPage({ narrative: 'slow-validation' });

    pick('Recommendations');

    const alert = await within(narrative()).findByRole('alert');
    expect(alert.textContent).toContain(
      'The draft referenced a figure that is not in the table and was discarded.',
    );
  });

  it('follows a draft being written when the page loads, and inserts it once it ends', async () => {
    setReportingMockLatency(0);
    resetReportingMock('2026-10-03');
    resetNcrMock('draft', { pdfDelayMs: 0 });
    resetCandidatesMock('computed');
    resetNarrativeDraftMock('slow', { readyAfterMs: 60_000 });
    await draftFromMock(2025, { section: 'overview', replaceAll: false }, crypto.randomUUID());
    vi.useFakeTimers({ toFake: ['Date'] });

    try {
      await renderPage({ keep: true });

      expect(within(sectionOf('Overview')).getByRole('status').textContent).toBe(
        'Drafting overview…',
      );
      vi.setSystemTime(Date.now() + 60_000);
      await waitFor(() => {
        expect(aiLabels('Overview')).toHaveLength(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows a newer draft another tab asked for, and lands it as that draft', async () => {
    setReportingMockLatency(0);
    resetReportingMock('2026-10-03');
    resetNcrMock('draft', { pdfDelayMs: 0 });
    resetCandidatesMock('computed');
    resetNarrativeDraftMock('slow', { readyAfterMs: 60_000 });
    await draftFromMock(2025, { section: 'overview', replaceAll: false }, crypto.randomUUID());
    vi.useFakeTimers({ toFake: ['Date'] });

    try {
      await renderPage({ keep: true });
      expect(within(sectionOf('Overview')).getByRole('status').textContent).toBe(
        'Drafting overview…',
      );

      // Another tab asks for the recommendations instead, replacing the overview's draft.
      await draftFromMock(
        2025,
        { section: 'recommendations', replaceAll: false },
        crypto.randomUUID(),
      );
      vi.setSystemTime(Date.now() + 60_000);

      expect(
        await screen.findByText('Drafted recommendations: 2 paragraphs. Review each one.'),
      ).toBeDefined();
      expect(aiLabels('Recommendations')).toHaveLength(2);
      expect(aiLabels('Overview')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
