// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Copilot,
  loadCopilot,
  rateOutput,
  readCopilotView,
} from '../../../server/copilot.server';
import {
  MOCK_DECLARATION,
  MOCK_FLAG_IDS,
  MOCK_ITEM_IDS,
  mockExplanations,
  mockFlags,
  mockSummary,
  setMockCopilot,
} from '../../../server/review/copilot-mock.server';
import {
  MOCK_CASE_IDS,
  mockReviewClient,
  resetReviewMock,
} from '../../../server/review/mock.server';
import type { CaseDetail, CopilotView } from '../../../server/review/types';
import { goToSignIn } from '../../sign-in-redirect';
import { CaseCopilot, type CaseCopilotProps } from './case-copilot';
import { CopilotPanel } from './copilot-panel';
import type { CopilotAccess } from './copilot-view';
import { sourceRefResolver } from './source-refs';
import type { CaseCopilot as CopilotState } from './use-case-copilot';

const ME = 'a1b2c3d4-0000-4000-8000-000000000001';

// The server functions, answered by the review mock as the signed-in reviewer.
vi.mock('../../sign-in-redirect', () => ({ goToSignIn: vi.fn() }));

vi.mock('../../../server/copilot', async () => {
  const { loadCopilot, refreshCopilot, rateOutput } =
    await import('../../../server/copilot.server');
  const { mockReviewClient } = await import('../../../server/review/mock.server');
  const client = () => mockReviewClient(ME, 'Grace Wanjiru');
  return {
    getCaseCopilot: vi.fn(({ data }: { data: { caseId: string } }) =>
      loadCopilot(client(), data.caseId),
    ),
    refreshCaseCopilot: vi.fn(({ data }: { data: { caseId: string } }) =>
      refreshCopilot(client(), data.caseId),
    ),
    rateCopilotOutput: vi.fn(
      ({
        data: { jobId, ...feedback },
      }: {
        data: { jobId: string } & Parameters<typeof rateOutput>[2];
      }) => rateOutput(client(), jobId, feedback),
    ),
  };
});

const { rateCopilotOutput } = await import('../../../server/copilot');

const NOW_MS = Date.parse('2026-10-01T09:00:00Z');
const CASE = MOCK_CASE_IDS.mine;

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS);
  resetReviewMock(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const detail: Pick<CaseDetail, 'flags' | 'document' | 'versions'> = {
  flags: mockFlags(CASE),
  document: MOCK_DECLARATION,
  versions: [
    {
      versionId: CASE,
      version: 1,
      submittedAt: '2026-04-01T00:00:00Z',
      late: false,
      amendment: false,
      firstOnAdili: false,
    },
  ],
};

function Mounted(props: Partial<CaseCopilotProps> & { startOpen?: boolean }) {
  const { startOpen = true, ...rest } = props;
  const [open, setOpen] = useState(startOpen);
  return (
    <TooltipProvider>
      <ToastProvider>
        <CaseCopilot
          caseId={CASE}
          detail={detail}
          access="assignee"
          open={open}
          onOpenChange={setOpen}
          now={new Date(NOW_MS)}
          {...rest}
        />
      </ToastProvider>
    </TooltipProvider>
  );
}

async function mount(props: Partial<CaseCopilotProps> & { startOpen?: boolean } = {}) {
  render(<Mounted {...props} />);
  await act(() => Promise.resolve());
}

const panel = () => screen.getByRole('complementary', { name: 'Copilot' });

describe('CaseCopilot (S15)', () => {
  it('shows the launcher with the state, and opens the panel', async () => {
    await mount({ startOpen: false });
    const launcher = screen.getByRole('button', {
      name: 'Open Copilot, AI-assisted. Summary ready',
    });
    fireEvent.click(launcher);
    expect(panel()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Copilot' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('labels the summary and every block as AI-assisted', async () => {
    await mount();
    expect(
      screen.getByRole('img', { name: /^AI-assisted · generated 3 hours ago for version 1\./ }),
    ).toBeTruthy();
    for (const title of [
      'Overview',
      'Changes since previous version',
      'By person',
      'Worth attention',
    ]) {
      const block = screen.getByRole('region', { name: title });
      expect(within(block).getByRole('img', { name: /^AI\. Summary · Anthropic/ })).toBeTruthy();
    }
    expect(screen.getByText('Indicators, not findings. A named reviewer decides.')).toBeTruthy();
  });

  it("ends every label's description with the output's disclaimer (design.md AiLabel, Q10)", async () => {
    await mount();
    const labels = screen.getAllByRole('img', { name: /AI-assisted|^AI\./ });
    expect(labels.length).toBeGreaterThan(1);
    for (const label of labels) {
      expect(label.getAttribute('aria-label')).toMatch(
        /indicators, not findings: a named reviewer examines the record and decides\.$/,
      );
    }
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Flags/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Flags/ }));
    fireEvent.click(screen.getByRole('button', { name: /Value changed by 150%/ }));
    const explained = screen.getAllByRole('img', { name: /^AI\./ });
    expect(explained.length).toBeGreaterThan(0);
    for (const label of explained) {
      expect(label.getAttribute('aria-label')).toMatch(/examines the record and decides\.$/);
    }
  });

  it('opens a source in the declaration pane, highlighted', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="decl-item-${MOCK_ITEM_IDS.plot}">Plot Kisumu/Manyatta/1234</div>`,
    );
    await mount();
    const changes = screen.getByRole('region', { name: 'Changes since previous version' });
    fireEvent.click(
      within(changes).getByRole('button', {
        name: 'Open in the declaration: Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
      }),
    );
    const target = document.getElementById(`decl-item-${MOCK_ITEM_IDS.plot}`);
    expect(target?.hasAttribute('data-target-highlight')).toBe(true);
    target?.remove();
  });

  it('opens a flag from Worth attention, explained', async () => {
    await mount();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open flag: New item not marked as acquired' }),
    );
    expect(screen.getByRole('tab', { name: /Flags/ }).getAttribute('aria-selected')).toBe('true');
    const flag = screen.getByRole('button', { name: /New item not marked as acquired/ });
    expect(flag.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('What this indicates')).toBeTruthy();
    expect(screen.getByText('An indicator, not a finding.')).toBeTruthy();
    expect(screen.getByText('The declarant confirms when and how it was acquired.')).toBeTruthy();
  });

  it('opens a flag asked for from outside (Explain on a flag)', async () => {
    await mount({ explain: { flagId: MOCK_FLAG_IDS.foreign, key: 1 } });
    expect(
      screen.getByRole('button', { name: /Holdings outside Kenya/ }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('marks reviewed flags and picks open ones for a clarification', async () => {
    const onToggle = vi.fn();
    await mount({
      explain: { flagId: MOCK_FLAG_IDS.valueChange, key: 1 },
      selection: { flagIds: [MOCK_FLAG_IDS.valueChange], onToggle, onClear: vi.fn() },
    });
    expect(screen.getByText('Reviewed')).toBeTruthy();
    expect(screen.getByText('1 flag selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Added to clarification' }));
    expect(onToggle).toHaveBeenCalledWith(MOCK_FLAG_IDS.valueChange);
  });

  it('rates each block of the summary and each explanation on its own (S13)', async () => {
    await mount();
    for (const name of [
      'Rate the overview',
      'Rate the changes since previous version',
      'Rate the by person summary',
      'Rate what is worth attention',
    ]) {
      expect(screen.getByRole('group', { name })).toBeTruthy();
    }
    const overview = screen.getByRole('group', { name: 'Rate the overview' });
    await act(() => {
      fireEvent.click(within(overview).getByRole('button', { name: 'Helpful' }));
      return Promise.resolve();
    });
    expect(rateCopilotOutput).toHaveBeenCalledWith({
      data: expect.objectContaining({
        block: 'overview',
        rating: 'helpful',
        reason: null,
        note: null,
      }) as unknown,
    });
    expect(
      within(overview).getByRole('button', { name: 'Helpful' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // Rating one block leaves the others unrated.
    expect(
      within(screen.getByRole('group', { name: 'Rate what is worth attention' }))
        .getByRole('button', { name: 'Helpful' })
        .getAttribute('aria-pressed'),
    ).toBe('false');

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Flags/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Flags/ }));
    fireEvent.click(screen.getByRole('button', { name: /Value changed by 150%/ }));
    const explanation = screen.getByRole('group', {
      name: 'Rate the explanation of Value changed by 150% since the previous declaration',
    });
    await act(() => {
      fireEvent.click(within(explanation).getByRole('button', { name: 'Helpful' }));
      return Promise.resolve();
    });
    expect(rateCopilotOutput).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ block: `flag:${MOCK_FLAG_IDS.valueChange}` }) as unknown,
    });
  });

  it('shows a supervisor the rating read-only, with refresh', async () => {
    // The reviewer holding the case rated it; the view lists the assignee's ratings to everyone.
    const client = mockReviewClient(ME, 'Grace Wanjiru');
    const loaded = await loadCopilot(client, CASE);
    if (!loaded.ok) throw new Error('not ok');
    await rateOutput(client, loaded.data.jobs.summarize ?? '', {
      block: 'overview',
      rating: 'helpful',
      reason: null,
      note: null,
    });
    await mount({ access: 'supervisor', assigneeName: 'Grace Wanjiru' });
    // Whose rating it is, as the supervisor did not give it.
    expect(screen.getByText('Grace Wanjiru: helpful')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Rate the overview' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh summary and explanations' })).toBeTruthy();
  });

  it('shows anyone else neither refresh nor ratings', async () => {
    await mount({ access: 'viewer' });
    expect(screen.queryByRole('button', { name: 'Refresh summary and explanations' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Rate the overview' })).toBeNull();
  });

  it('refreshes: pending with a skeleton until the new outputs are ready (S11)', async () => {
    await mount();
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh summary and explanations' }));
      return Promise.resolve();
    });
    expect(screen.getAllByText('Preparing summary…').length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole('button', { name: 'Refresh summary and explanations' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('says so in a toast when a refresh is refused', async () => {
    setMockCopilot(MOCK_CASE_IDS.peters, {});
    render(<Mounted caseId={MOCK_CASE_IDS.peters} access="assignee" />);
    await act(() => Promise.resolve());
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh summary and explanations' }));
      return Promise.resolve();
    });
    expect(
      screen.getByText('Only the reviewer holding the case or a supervisor can refresh it.'),
    ).toBeTruthy();
  });

  it('renders nothing for a case the reviewer cannot see', async () => {
    render(<Mounted caseId="00000000-0000-4000-8000-000000000000" />);
    await act(() => Promise.resolve());
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

/** The panel in one state, as the hook would hand it over. */
function renderState(
  view: Partial<CopilotView>,
  {
    access = 'assignee',
    stopped = false,
    sessionEnded = false,
  }: { access?: CopilotAccess; stopped?: boolean; sessionEnded?: boolean } = {},
  flags = mockFlags(CASE),
  versions: CaseDetail['versions'] = detail.versions,
) {
  const at = '2026-10-01T06:00:00Z';
  const copilot: Copilot = readCopilotView({
    status: 'ready',
    forVersionId: CASE,
    generatedAt: at,
    failureReason: null,
    summary: mockSummary(at),
    explanations: mockExplanations(at),
    jobs: { summarize: 'aaaa0000-0000-4000-8000-000000000001', explain: null },
    feedback: [],
    ...view,
  });
  const state: CopilotState = {
    copilot,
    error: null,
    stopped,
    sessionEnded,
    refreshing: false,
    retry: vi.fn(),
    refresh: vi.fn(() => Promise.resolve(null)),
    ratingOf: () => null,
    rate: vi.fn(() => Promise.resolve()),
  };
  const onRefresh = vi.fn();
  render(
    <TooltipProvider>
      <CopilotPanel
        state={state}
        access={access}
        flags={flags}
        versions={versions}
        resolveRef={sourceRefResolver(MOCK_DECLARATION)}
        onClose={vi.fn()}
        onRefresh={onRefresh}
        onOpenSource={vi.fn()}
        now={new Date(NOW_MS)}
      />
    </TooltipProvider>,
  );
  return { state, onRefresh };
}

const nothing = { summary: null, explanations: null, generatedAt: null };

describe('CopilotPanel states (S15)', () => {
  it('pending: preparing, announced', () => {
    renderState({ status: 'pending', ...nothing });
    expect(screen.getAllByText('Preparing summary…')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Preparing summary');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('pending for two minutes: Check again', () => {
    const { state } = renderState({ status: 'pending', ...nothing }, { stopped: true });
    expect(screen.getByText('Still preparing.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(state.retry).toHaveBeenCalled();
  });

  it.each(['pending', 'stale'] as const)(
    '%s when the session ended: says so instead of preparing forever (Q8)',
    (status) => {
      renderState(status === 'pending' ? { status, ...nothing } : { status }, {
        sessionEnded: true,
      });
      expect(screen.getByText('Your session has ended.')).toBeTruthy();
      expect(screen.queryByText('Preparing summary…')).toBeNull();
      expect(screen.queryByText('Declaration or registry results changed. Updating…')).toBeNull();
      // Nothing is loading any more, so no skeleton says it is.
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      expect(goToSignIn).toHaveBeenCalledWith();
    },
  );

  it('keeps the panel (and the focus in it) when the outputs arrive (N1)', () => {
    const at = '2026-10-01T06:00:00Z';
    const view = (over: Partial<CopilotView>): Copilot =>
      readCopilotView({
        status: 'ready',
        forVersionId: CASE,
        generatedAt: at,
        failureReason: null,
        summary: mockSummary(at),
        explanations: mockExplanations(at),
        jobs: { summarize: 'aaaa0000-0000-4000-8000-000000000001', explain: null },
        feedback: [],
        ...over,
      });
    const state = (copilot: Copilot): CopilotState => ({
      copilot,
      error: null,
      stopped: false,
      sessionEnded: false,
      refreshing: false,
      retry: vi.fn(),
      refresh: vi.fn(() => Promise.resolve(null)),
      ratingOf: () => null,
      rate: vi.fn(() => Promise.resolve()),
    });
    const panelOf = (copilot: Copilot) => (
      <TooltipProvider>
        <CopilotPanel
          state={state(copilot)}
          access="assignee"
          flags={mockFlags(CASE)}
          versions={detail.versions}
          resolveRef={sourceRefResolver(MOCK_DECLARATION)}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onOpenSource={vi.fn()}
          now={new Date(NOW_MS)}
        />
      </TooltipProvider>
    );
    const { rerender } = render(panelOf(view({ status: 'pending', ...nothing })));
    const before = panel();
    const close = screen.getByRole('button', { name: 'Close Copilot' });
    close.focus();
    rerender(panelOf(view({})));
    expect(panel()).toBe(before);
    expect(document.activeElement).toBe(close);
  });

  it('stale: the old content greyed out under a banner', () => {
    renderState({ status: 'stale' });
    expect(screen.getByText('Declaration or registry results changed. Updating…')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Overview' })).toBeNull();
    const overview = screen.getByText(/^Biennial declaration by John Kennedy Otieno/);
    expect(overview.closest('[inert]')).toBeTruthy();
  });

  it.each([
    ['provider-unavailable', 'The summary could not be produced (AI service unavailable).'],
    ['refused', 'The summary could not be produced (declined by the AI model).'],
    ['validation', 'The summary could not be produced (output failed its checks).'],
  ])('failed (%s): the reason and Try again', (reason, text) => {
    const { onRefresh } = renderState({ status: 'failed', failureReason: reason, ...nothing });
    expect(screen.getByRole('alert').textContent).toContain(text);
    expect(
      screen.getByText('Flags, registry checks and clarifications work as usual.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('failed on the budget: when it resets, no Try again', () => {
    renderState({ status: 'failed', failureReason: 'budget', ...nothing });
    expect(screen.getByRole('alert').textContent).toContain(
      'The summary could not be produced (monthly AI budget used up).The budget resets on 1 Nov 2026.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('failed, seen by someone else: no Try again', () => {
    renderState({ status: 'failed', failureReason: 'provider', ...nothing }, { access: 'viewer' });
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('not enabled: says so, explains why, and offers a refresh, which asks again', () => {
    renderState({ status: 'not-enabled', ...nothing });
    expect(screen.getByText('AI assistance is not enabled for this Commission.')).toBeTruthy();
    // Refresh could only end blocked again; a policy change asks again by itself (e2e 37).
    expect(screen.queryByRole('button', { name: 'Refresh summary and explanations' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Learn why' }));
    const dialog = screen.getByRole('dialog', { name: 'Why AI is not enabled' });
    expect(within(dialog).getByText(/nothing from a declaration is sent/)).toBeTruthy();
  });

  it('first declaration: nothing to compare', () => {
    const [v1] = detail.versions;
    if (!v1) throw new Error('no version');
    renderState(
      { summary: { ...mockSummary('2026-10-01T06:00:00Z'), changesSincePrevious: [] } },
      {},
      mockFlags(CASE),
      [{ ...v1, firstOnAdili: true }],
    );
    expect(screen.getByText('First declaration on Adili. Nothing to compare.')).toBeTruthy();
  });

  it('stale after an amendment: version 1’s output still says it had nothing to compare (e2e 18)', () => {
    const [v1] = detail.versions;
    if (!v1) throw new Error('no version');
    // The amendment replaced version 1's flags, its no-previous-version among them.
    renderState(
      {
        status: 'stale',
        forVersionId: v1.versionId,
        summary: { ...mockSummary('2026-10-01T06:00:00Z'), changesSincePrevious: [] },
      },
      {},
      mockFlags('fe150000-0000-4000-8000-000000000002'),
      [
        { ...v1, firstOnAdili: true },
        {
          versionId: 'fe150000-0000-4000-8000-000000000002',
          version: 2,
          submittedAt: '2026-05-01T00:00:00Z',
          late: false,
          amendment: true,
          firstOnAdili: false,
        },
      ],
    );
    expect(screen.getByText('First declaration on Adili. Nothing to compare.')).toBeTruthy();
    expect(screen.queryByText('No material changes.')).toBeNull();
  });

  it('no changes on a later declaration', () => {
    renderState({ summary: { ...mockSummary('2026-10-01T06:00:00Z'), changesSincePrevious: [] } });
    expect(screen.getByText('No material changes.')).toBeTruthy();
  });
});
