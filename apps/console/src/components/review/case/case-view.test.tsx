// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addCaseNote,
  claimCase,
  getCaseComparison,
  markCaseFlagReviewed,
  reassignCase,
  releaseCase,
} from '../../../server/review-case';
import { type CaseView as CaseViewData, loadCaseView } from '../../../server/review-case.server';
import { MOCK_FLAG_IDS as F, MOCK_ITEM_IDS as I } from '../../../server/review/copilot-mock.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_OFFICERS,
  mockReviewClient,
  resetReviewMock,
} from '../../../server/review/mock.server';
import type { Assignee } from '../../../server/review/types';
import { CaseView } from './case-view';

const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const NOW_MS = Date.parse('2026-10-02T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();

// The page reads the case again when the router is invalidated; the harness answers it.
const harness: { reload: () => Promise<void>; load: CaseViewData | null } = {
  reload: () => Promise.resolve(),
  load: null,
};
const invalidate = vi.fn(() => harness.reload());

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => {
    let href = to;
    for (const [name, value] of Object.entries(params ?? {}))
      href = href.replace(`$${name}`, value);
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  useRouter: () => ({
    invalidate,
    get state() {
      return {
        matches: [
          {
            routeId: '/review/cases/$caseId/',
            loaderData: harness.load ? { ok: true, data: harness.load, now: NOW } : null,
          },
        ],
      };
    },
  }),
}));

// The server functions, answered by the review mock as the signed-in officer.
vi.mock('../../../server/review-case', async () => {
  const server = await import('../../../server/review-case.server');
  const { MOCK_OFFICERS: officers, mockReviewClient } =
    await import('../../../server/review/mock.server');
  const client = () => mockReviewClient('a1b2c3d4-0000-4000-8000-000000000001', 'Faith Achieng');
  interface Data<T> {
    data: T;
  }
  return {
    claimCase: vi.fn(({ data }: Data<{ caseId: string }>) => server.claim(client(), data.caseId)),
    releaseCase: vi.fn(({ data }: Data<{ caseId: string }>) =>
      server.release(client(), data.caseId),
    ),
    reassignCase: vi.fn(({ data }: Data<{ caseId: string; assignee: string | null }>) =>
      server.reassign(client(), data.caseId, data.assignee),
    ),
    addCaseNote: vi.fn(({ data }: Data<{ caseId: string; text: string }>) =>
      server.addNote(client(), data.caseId, data.text),
    ),
    markCaseFlagReviewed: vi.fn(
      ({ data }: Data<{ caseId: string; flagId: string; note: string }>) =>
        server.markFlagReviewed(client(), data.caseId, data.flagId, data.note),
    ),
    getCaseAttachmentLink: vi.fn(({ data }: Data<{ caseId: string; uploadId: string }>) =>
      server.attachmentLink(client(), data.caseId, data.uploadId),
    ),
    // The Commission's reviewers (the review mock has no reviewer list): two besides the holder.
    getReviewers: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: [
          { subject: officers.mercy.subject, name: 'Mercy Wambui', open: 2, ofRecord: true },
          {
            subject: 'a1b2c3d4-0000-4000-8000-000000000001',
            name: 'Faith Achieng',
            open: 1,
            ofRecord: false,
          },
        ],
      }),
    ),
    getCaseComparison: vi.fn(({ data }: Data<{ caseId: string }>) =>
      server.loadComparison(client(), data.caseId),
    ),
    getCaseRegistry: vi.fn(() => new Promise(() => undefined)),
    getCaseRegistryStatus: vi.fn(),
    recheckCaseRegistries: vi.fn(),
  };
});
vi.mock('../../../server/copilot', async () => {
  const { loadCopilot } = await import('../../../server/copilot.server');
  const { mockReviewClient } = await import('../../../server/review/mock.server');
  const client = () => mockReviewClient('a1b2c3d4-0000-4000-8000-000000000001', 'Faith Achieng');
  return {
    getCaseCopilot: vi.fn(({ data }: { data: { caseId: string } }) =>
      loadCopilot(client(), data.caseId),
    ),
    refreshCaseCopilot: vi.fn(),
    rateCopilotOutput: vi.fn(),
  };
});
vi.mock('../../../server/clarifications', () => ({
  saveClarificationDraft: vi.fn(),
  issueComposedClarification: vi.fn(),
}));

async function loaded(caseId: string): Promise<CaseViewData> {
  const result = await loadCaseView(mockReviewClient(ME.subject, ME.name), caseId, ME);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

function Harness({ initial, supervisor }: { initial: CaseViewData; supervisor: boolean }) {
  const [load, setLoad] = useState(initial);
  useEffect(() => {
    harness.load = load;
    harness.reload = async () => {
      const next = await loaded(initial.detail.case.id);
      harness.load = next;
      setLoad(next);
    };
  }, [load, initial.detail.case.id]);
  return (
    <CaseView
      load={load}
      now={NOW}
      supervisor={supervisor}
      slug="tsc"
      commission={{ name: 'Teachers Service Commission', issuerCode: 'TSC' }}
    />
  );
}

async function renderCase(caseId: string, { supervisor = false } = {}) {
  const initial = await loaded(caseId);
  harness.load = initial;
  render(
    <TooltipProvider>
      <ToastProvider>
        <Harness initial={initial} supervisor={supervisor} />
      </ToastProvider>
    </TooltipProvider>,
  );
  // Let the copilot's first read land.
  await act(async () => {
    await Promise.resolve();
  });
}

/** Clicks, then lets the server function and the reload it causes land. */
async function clickAndSettle(click: () => void) {
  await act(async () => {
    click();
    await Promise.resolve();
  });
}

const button = (name: string | RegExp) => screen.queryByRole('button', { name });

function openTab(name: RegExp) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  window.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS);
  resetReviewMock(NOW_MS);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CaseView: the reviewer holding the case', () => {
  it('heads the case with its reference, status, priority, window and the Release action', async () => {
    await renderCase(CASES.mine);
    expect(screen.getByRole('heading', { level: 1, name: 'John Kennedy Otieno' })).toBeTruthy();
    expect(screen.getByText('DCI-TSC-2026-0003418-P')).toBeTruthy();
    expect(screen.getByText('Awaiting clarification')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /^High priority\. Indicator for ordering only/ }),
    ).toBeTruthy();
    expect(screen.getByText('Late filing')).toBeTruthy();
    // In the header and on the declaration pane.
    expect(screen.getAllByText('Version 2 of 2')).toHaveLength(2);
    expect(screen.getByText('Window closes 1 Nov 2026 · 30 days left')).toBeTruthy();
    expect(screen.getByText('2 reviewers of record')).toBeTruthy();
    expect(button('Release')).toBeTruthy();
    expect(button('Claim')).toBeNull();
    expect(button('Reassign')).toBeNull();
    expect(
      screen.getByText('Your access to this declaration is recorded in the audit trail.'),
    ).toBeTruthy();
  });

  it('links to the Determination page; Propose for the assignee of a case ready for it (spec 08)', async () => {
    await renderCase(CASES.mine);
    // A clarification is open: the link reads Determination, not Propose.
    expect(screen.getByRole('link', { name: 'Determination' }).getAttribute('href')).toBe(
      `/review/cases/${CASES.mine}/determination`,
    );
    cleanup();
    await renderCase(CASES.ready);
    expect(screen.getByRole('link', { name: 'Propose determination' })).toBeTruthy();
  });

  it('shows the declaration as filed, with the ids the copilot and flags scroll to', async () => {
    await renderCase(CASES.mine);
    const pane = screen.getByRole('region', { name: 'Declaration as filed' });
    for (const section of ['personal', 'spouses', 'children', 'other']) {
      expect(document.getElementById(`decl-section-${section}`)).toBeTruthy();
    }
    expect(document.getElementById('decl-statement-officer')).toBeTruthy();
    const plot = document.getElementById(`decl-item-${I.plot}`);
    expect(plot?.textContent).toContain('Plot Kisumu/Manyatta/1234');
    expect(plot?.textContent).toContain('KES 4,500,000');
    // On the item, and in the attachments list.
    expect(
      within(pane).getAllByRole('button', { name: 'Download Title deed Kisumu-Manyatta-1234.pdf' }),
    ).toHaveLength(2);
  });

  it('labels each total with its column, for the lines it becomes on phones (mobile case view)', async () => {
    await renderCase(CASES.mine);
    const pane = screen.getByRole('region', { name: 'Declaration as filed' });
    const totals = within(pane).getAllByRole('table')[0];
    if (!totals) throw new Error('no totals table');
    const row = within(totals).getAllByRole('row')[1];
    if (!row) throw new Error('no totals row');
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.getAttribute('data-label')),
    ).toEqual(['Income', 'Assets', 'Liabilities']);
    expect(totals.querySelector('thead')?.className).toContain('max-sm:sr-only');
  });

  it('groups open flags by severity under the indicator banner', async () => {
    await renderCase(CASES.mine);
    expect(
      screen.getByText('Flags are indicators to guide your review. They are not findings.'),
    ).toBeTruthy();
    expect(screen.getByText('4 open · 1 reviewed')).toBeTruthy();
    const high = screen.getByRole('region', { name: 'high severity' });
    expect(within(high).getByText('Value up 150% from the previous version')).toBeTruthy();
    expect(
      within(high).getByText('Assets · Land · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno'),
    ).toBeTruthy();
    expect(screen.getByText('Reviewed by Peter Mwangi on 7 May 2026')).toBeTruthy();
  });

  it('marks a flag reviewed with a note, and the flag collapses with the note and reviewer (S11)', async () => {
    await renderCase(CASES.mine);
    const flag = screen.getByRole('article', { name: 'New item not marked as acquired' });
    fireEvent.click(within(flag).getByRole('button', { name: 'Mark reviewed' }));
    fireEvent.click(within(flag).getByRole('button', { name: 'Mark reviewed' }));
    expect(within(flag).getByText('Add a note to record what you concluded.')).toBeTruthy();
    expect(vi.mocked(markCaseFlagReviewed)).not.toHaveBeenCalled();

    fireEvent.change(within(flag).getByLabelText('What did you conclude?'), {
      target: { value: 'Bought with the 2025 bonus; payslip attached.' },
    });
    await clickAndSettle(() => {
      fireEvent.click(within(flag).getByRole('button', { name: 'Mark reviewed' }));
    });
    expect(vi.mocked(markCaseFlagReviewed)).toHaveBeenCalledWith({
      data: {
        caseId: CASES.mine,
        flagId: F.acquisition,
        note: 'Bought with the 2025 bonus; payslip attached.',
      },
    });
    expect(screen.getByText('3 open · 2 reviewed')).toBeTruthy();
    const reviewed = screen.getByRole('region', { name: 'Reviewed 2' });
    expect(within(reviewed).getByText('Reviewed by Faith Achieng on 2 Oct 2026')).toBeTruthy();
    expect(
      within(reviewed).getByText('Bought with the 2025 bonus; payslip attached.'),
    ).toBeTruthy();
    expect(screen.getAllByText('Marked reviewed').length).toBeGreaterThan(0);
  });

  it('goes to the item a flag concerns, and from an item’s pin to its flag', async () => {
    await renderCase(CASES.mine);
    const flag = screen.getByRole('article', { name: /Value changed by 150%/ });
    fireEvent.click(within(flag).getByRole('button', { name: 'Go to item' }));
    expect(
      document.getElementById(`decl-item-${I.plot}`)?.hasAttribute('data-target-highlight'),
    ).toBe(true);

    const plot = document.getElementById(`decl-item-${I.plot}`);
    if (!plot) throw new Error('no plot');
    fireEvent.click(
      within(plot).getByRole('button', {
        name: /^1 indicator on this item, \w+ severity\. Show in flags\.$/,
      }),
    );
    expect(document.activeElement?.id).toBe(`flag-${F.valueChange}`);
  });

  it('offers Explain once the copilot is ready, and opens it on the flag', async () => {
    await renderCase(CASES.mine);
    const flag = screen.getByRole('article', { name: 'New item not marked as acquired' });
    fireEvent.click(within(flag).getByRole('button', { name: 'Explain' }));
    expect(screen.queryByRole('tab', { name: /Notes/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Flags/, selected: true })).toBeTruthy();
  });

  it('opens the composer from the Clarifications tab', async () => {
    await renderCase(CASES.mine);
    openTab(/Clarifications/);
    fireEvent.click(screen.getByRole('button', { name: 'New clarification' }));
    const drawer = screen.getByRole('dialog', { name: 'New clarification' });
    expect(
      within(drawer).getByText('To John Kennedy Otieno · re: DCI-TSC-2026-0003418-P'),
    ).toBeTruthy();
  });

  it("opens the composer with the flags picked in the copilot as Draft with AI's", async () => {
    await renderCase(CASES.mine);
    const flag = screen.getByRole('article', { name: /Value changed by 150%/ });
    fireEvent.click(within(flag).getByRole('button', { name: 'Explain' }));
    const [add] = screen.getAllByRole('button', { name: /Add to clarification/ });
    if (!add) throw new Error('no Add to clarification');
    fireEvent.click(add);
    expect(screen.getByText('1 flag selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New clarification' }));
    const drawer = screen.getByRole('dialog', { name: 'New clarification' });
    const drafting = within(drawer).getByRole('region', { name: 'Draft with AI' });
    expect(
      within(drafting).getByRole('button', {
        name: 'Remove Value changed by 150% since the previous declaration',
      }),
    ).toBeTruthy();
    // The composer starts as for any new clarification: one blank item.
    expect(within(drawer).getAllByRole('region', { name: /^Item / })).toHaveLength(1);

    // Removing the chip unpicks the flag in the copilot too.
    fireEvent.click(
      within(drafting).getByRole('button', {
        name: 'Remove Value changed by 150% since the previous declaration',
      }),
    );
    expect(screen.queryByText('1 flag selected')).toBeNull();
  });

  it('adds a note, and refuses an empty one', async () => {
    await renderCase(CASES.mine);
    openTab(/Notes/);
    expect(
      screen.getByText('Notes are internal to your Commission. The declarant never sees them.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(screen.getByText('Write a note first.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add note'), {
      target: { value: 'Asked HR for the leave letter.' },
    });
    await clickAndSettle(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });
    expect(vi.mocked(addCaseNote)).toHaveBeenCalledWith({
      data: { caseId: CASES.mine, text: 'Asked HR for the leave letter.' },
    });
    const notes = screen.getByRole('list', { name: 'Notes' });
    expect(within(notes).getAllByRole('listitem')[0]?.textContent).toContain(
      'Asked HR for the leave letter.',
    );
  });

  it('lists the case’s events on the Timeline tab', async () => {
    await renderCase(CASES.mine);
    openTab(/Timeline/);
    expect(screen.getByText('Case created from version 1')).toBeTruthy();
    expect(
      screen.getByText('Version 2 processed: flags recomputed, reviewed flags kept'),
    ).toBeTruthy();
    expect(screen.getAllByText('Claimed').length).toBe(2);
  });

  it('releases the case after a confirmation', async () => {
    await renderCase(CASES.mine);
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    const dialog = screen.getByRole('dialog', { name: 'Release this case?' });
    await clickAndSettle(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Release case' }));
    });
    expect(vi.mocked(releaseCase)).toHaveBeenCalledWith({ data: { caseId: CASES.mine } });
    expect(screen.getByText('Case released to the queue')).toBeTruthy();
    expect(button('Claim')).toBeTruthy();
  });

  it('still shows the case when the declaration could not be loaded', async () => {
    await renderCase(CASES.unavailable);
    expect(screen.getByText('The declaration could not be loaded.')).toBeTruthy();
    expect(screen.getByText('Flags, notes and clarifications are still available.')).toBeTruthy();
    expect(button('Try again')).toBeTruthy();
    expect(screen.getByRole('article', { name: /Value changed by 150%/ })).toBeTruthy();
  });
});

describe('CaseView: other reviewers', () => {
  it('reads another reviewer’s case read-only', async () => {
    await renderCase(CASES.peters);
    expect(screen.getByText('Read-only. Peter Mwangi holds this case.')).toBeTruthy();
    expect(button('Release')).toBeNull();
    expect(button('Mark reviewed')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Go to item' }).length).toBeGreaterThan(0);
  });

  it('claims an unassigned case', async () => {
    await renderCase(CASES.unassigned);
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getByText('First declaration on Adili')).toBeTruthy();
    await clickAndSettle(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    });
    expect(vi.mocked(claimCase)).toHaveBeenCalledWith({ data: { caseId: CASES.unassigned } });
    expect(screen.getByText('Case claimed. You hold it now.')).toBeTruthy();
    expect(button('Release')).toBeTruthy();
  });

  it('says who claimed it first when a claim loses the race (409)', async () => {
    await renderCase(CASES.contested);
    await clickAndSettle(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    });
    expect(screen.getByText('Already claimed by Mercy Wambui')).toBeTruthy();
    expect(screen.getByText('Read-only. Mercy Wambui holds this case.')).toBeTruthy();
  });
});

describe('CaseView: a supervisor', () => {
  it('reassigns a case to a reviewer of record', async () => {
    await renderCase(CASES.peters, { supervisor: true });
    expect(screen.queryByText(/Read-only/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    const dialog = screen.getByRole('dialog', { name: 'Reassign case' });
    expect(within(dialog).getByText('Currently held by Peter Mwangi.')).toBeTruthy();
    const options = await within(dialog).findAllByRole('radio');
    expect(options).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Mercy Wambui/ }));
    await clickAndSettle(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    });
    expect(vi.mocked(reassignCase)).toHaveBeenCalledWith({
      data: { caseId: CASES.peters, assignee: MOCK_OFFICERS.mercy.subject },
    });
    expect(screen.getByText('Reassigned to Mercy Wambui')).toBeTruthy();
  });

  it('unassigns a case after a confirmation', async () => {
    await renderCase(CASES.peters, { supervisor: true });
    fireEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    const dialog = screen.getByRole('dialog', { name: 'Unassign this case?' });
    await clickAndSettle(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Unassign' }));
    });
    expect(vi.mocked(reassignCase)).toHaveBeenCalledWith({
      data: { caseId: CASES.peters, assignee: null },
    });
    expect(screen.getByText('Case unassigned')).toBeTruthy();
  });

  it('confirms a claim, as it makes the supervisor a reviewer of record', async () => {
    await renderCase(CASES.unassigned, { supervisor: true });
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    const dialog = screen.getByRole('dialog', { name: 'Claim this case?' });
    expect(within(dialog).getByText(/You become a reviewer of record/)).toBeTruthy();
    await clickAndSettle(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Claim case' }));
    });
    expect(vi.mocked(claimCase)).toHaveBeenCalled();
    expect(
      screen.getByText(
        'You are a reviewer of record, so another supervisor must approve the determination.',
      ),
    ).toBeTruthy();
  });
});

describe('CaseView: version compare (S10, S19)', () => {
  const compareSwitch = (name = /^Compare with/) => screen.getByRole('switch', { name });

  async function turnOn(name?: RegExp) {
    await clickAndSettle(() => {
      fireEvent.click(compareSwitch(name));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('switches the declaration pane to a DiffTable per statement, read once when turned on', async () => {
    await renderCase(CASES.mine);
    const toggle = compareSwitch(/^Compare with version 1$/);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(getCaseComparison).not.toHaveBeenCalled();

    await turnOn();
    expect(compareSwitch().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: 'Version comparison' })).toBeTruthy();
    expect(screen.getByText('8 matched')).toBeTruthy();
    expect(screen.getByText('2 changed 25%+')).toBeTruthy();
    expect(screen.getByText('3 in one version only')).toBeTruthy();

    const officer = screen.getByRole('table', {
      name: 'Changes for John Kennedy Otieno between version 1 and version 2',
    });
    const plot = within(officer).getByRole('rowheader', { name: /Plot Kisumu\/Manyatta\/1234/ });
    const plotRow = within(plot.closest('tr') as HTMLElement);
    expect(plotRow.getByText('1,800,000')).toBeTruthy();
    expect(plotRow.getByText('4,500,000')).toBeTruthy();
    expect(plotRow.getByText('Increase of KES 2,700,000')).toBeTruthy();
    expect(plotRow.getByText('+150.0%')).toBeTruthy();
    expect(plotRow.getByText('Not marked')).toBeTruthy();
    // A decrease, with a true minus sign, read out in words.
    const mortgage = within(officer).getByRole('rowheader', { name: /Mortgage from KCB Bank/ });
    const mortgageRow = within(mortgage.closest('tr') as HTMLElement);
    expect(mortgageRow.getByText('−500,000')).toBeTruthy();
    expect(mortgageRow.getByText('Decrease of KES 500,000')).toBeTruthy();
    expect(mortgageRow.getByText('−12.8%')).toBeTruthy();
    expect(mortgageRow.getByText('Down 12.8 percent')).toBeTruthy();
    // Unmatched on both sides.
    const fund = within(officer).getByRole('rowheader', { name: /CIC Money Market Fund units/ });
    expect(within(fund.closest('tr') as HTMLElement).getByText(/Only in version 2/)).toBeTruthy();
    const car = within(officer).getByRole('rowheader', { name: /Toyota Probox KCA 123X/ });
    expect(
      within(car.closest('tr') as HTMLElement).getByText('Not in current version'),
    ).toBeTruthy();
    // A matched item whose previous value was nothing has no percentage.
    const child = screen.getByRole('table', { name: /^Changes for Brenda Otieno/ });
    expect(within(child).getByText('No percentage: the previous value was zero')).toBeTruthy();
    // The declaration as filed is replaced, and comes back when Compare is turned off.
    expect(screen.queryByRole('heading', { level: 2, name: 'Declaration as filed' })).toBeNull();

    await turnOn();
    expect(screen.getByRole('heading', { level: 2, name: 'Declaration as filed' })).toBeTruthy();
    await turnOn();
    expect(getCaseComparison).toHaveBeenCalledTimes(1);
  });

  it('turns Compare off to go to the item a flag concerns', async () => {
    await renderCase(CASES.mine);
    await turnOn();
    await clickAndSettle(() => {
      const [first] = screen.getAllByRole('button', { name: 'Go to item' });
      if (first) fireEvent.click(first);
    });
    expect(compareSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('heading', { level: 2, name: 'Declaration as filed' })).toBeTruthy();
  });

  it('compares a single version with the previous declaration', async () => {
    await renderCase(CASES.peters);
    await turnOn(/^Compare with previous declaration$/);
    const table = screen.getByRole('table', {
      name: 'Changes for Mary Achieng between the previous declaration and version 1',
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .slice(1, 3)
        .map((th) => th.textContent),
    ).toEqual(['Previous (KES)', 'Version 1 (KES)']);
    expect(screen.getByText(/^Previous declaration → v1 /)).toBeTruthy();
  });

  it('cannot compare a first declaration on Adili, and says why', async () => {
    await renderCase(CASES.unassigned);
    const toggle = compareSwitch();
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('First declaration on Adili: nothing to compare.')).toBeTruthy();
    fireEvent.click(toggle);
    expect(getCaseComparison).not.toHaveBeenCalled();
  });

  it('says there is nothing to compare when review finds no previous version (409)', async () => {
    await renderCase(CASES.mine);
    vi.mocked(getCaseComparison).mockResolvedValueOnce({ ok: true, data: null });
    await turnOn();
    expect(screen.getByText('Nothing to compare')).toBeTruthy();
    expect(
      screen.getByText('This is the first declaration on Adili for this person.'),
    ).toBeTruthy();
  });

  it('offers Try again when the comparison could not be loaded', async () => {
    await renderCase(CASES.mine);
    vi.mocked(getCaseComparison).mockResolvedValueOnce({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    await turnOn();
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => alert.textContent.includes('The comparison could not be loaded.')),
    ).toBe(true);
    await clickAndSettle(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('8 matched')).toBeTruthy();
  });
});
