// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addCaseNote,
  claimCase,
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
  const { mockReviewClient } = await import('../../../server/review/mock.server');
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
      document.getElementById(`decl-item-${I.plot}`)?.hasAttribute('data-copilot-highlight'),
    ).toBe(true);

    const plot = document.getElementById(`decl-item-${I.plot}`);
    if (!plot) throw new Error('no plot');
    fireEvent.click(
      within(plot).getByRole('button', { name: '1 indicator on this item. Show in flags.' }),
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

describe('CaseView: other officers', () => {
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
    const options = within(dialog).getAllByRole('radio');
    expect(options).toHaveLength(2);
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
