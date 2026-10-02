// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  raiseFollowUpClarification,
  resolveClarification,
  withdrawClarification,
} from '../../server/clarifications';
import {
  type ClarificationDetail,
  loadClarificationDetail,
} from '../../server/clarifications.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_CLARIFICATION_IDS as K,
  mockReviewClient,
  resetReviewMock,
} from '../../server/review/mock.server';
import type { CopilotDraftInput } from '../../server/review/types';
import { ClarificationDetailView, LETTER_REFRESH_MS } from './clarification-detail';

const navigate = vi.fn(() => Promise.resolve());
const invalidate = vi.fn(() => Promise.resolve());

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
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate }),
}));
vi.mock('../../server/clarifications', () => ({
  resolveClarification: vi.fn(),
  withdrawClarification: vi.fn(),
  raiseFollowUpClarification: vi.fn(),
  getLetterLink: vi.fn(),
  getResponseAttachmentLink: vi.fn(),
  saveClarificationDraft: vi.fn(),
  issueComposedClarification: vi.fn(),
}));

vi.mock('../../server/copilot', async () => {
  const { pollDraft, requestDraft } = await import('../../server/copilot-drafts.server');
  const { mockReviewClient } = await import('../../server/review/mock.server');
  const client = () => mockReviewClient(ME, 'Grace Wanjiru');
  return {
    draftClarificationWithAi: vi.fn(
      ({
        data: { caseId, key, ...input },
      }: {
        data: CopilotDraftInput & { caseId: string; key: string };
      }) => requestDraft(client(), caseId, input, key),
    ),
    getCopilotDraft: vi.fn(({ data }: { data: { draftId: string } }) =>
      pollDraft(client(), data.draftId),
    ),
  };
});

const resolveMock = vi.mocked(resolveClarification);
const withdrawMock = vi.mocked(withdrawClarification);
const followUpMock = vi.mocked(raiseFollowUpClarification);

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';

async function detailOf(caseId: string, clarificationId: string): Promise<ClarificationDetail> {
  const client = mockReviewClient(ME, 'Grace Wanjiru');
  const result = await loadClarificationDetail(client, caseId, clarificationId, ME, NOW);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

function renderDetail(detail: ClarificationDetail, supervisor = false) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <ClarificationDetailView
          detail={detail}
          now={NOW}
          supervisor={supervisor}
          commission={{ name: 'Teachers Service Commission', issuerCode: 'TSC' }}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
}

const button = (name: string) => screen.queryByRole('button', { name });

beforeEach(() => {
  resetReviewMock(NOW_MS);
  for (const mock of [resolveMock, withdrawMock, followUpMock, navigate, invalidate]) {
    mock.mockClear();
  }
});

describe('ClarificationDetailView: states', () => {
  it('waits for the declarant on an issued clarification: only withdraw', async () => {
    renderDetail(await detailOf(CASES.mine, K.issued));
    expect(screen.getByRole('heading', { level: 1, name: 'John Kennedy Otieno' })).toBeTruthy();
    // The status badge and the letter's.
    expect(screen.getAllByText('Issued')).toHaveLength(2);
    expect(screen.getByText('Waiting for the declarant.')).toBeTruthy();
    expect(screen.getByText('Due in 22 days. Reminder goes 10 Oct 2026.')).toBeTruthy();
    expect(screen.getAllByText('No response yet.')).toHaveLength(2);
    expect(button('Mark resolved')).toBeNull();
    expect(button('Withdraw')).toBeTruthy();
    expect(button('Raise follow-up')).toBeNull();
    expect(
      screen.getByText('Your access to this declaration is recorded in the audit trail.'),
    ).toBeTruthy();
  });

  it('shows a late response beside each item with its documents', async () => {
    renderDetail(await detailOf(CASES.mine, K.late));
    expect(screen.getByText('Responded 3 days late')).toBeTruthy();
    expect(screen.getByText('Late')).toBeTruthy();
    const first = within(screen.getByRole('list', { name: 'Items and responses' })).getAllByRole(
      'listitem',
    )[0];
    if (!first) throw new Error('no items');
    expect(within(first).getByText('Explain the discrepancy or inconsistency')).toBeTruthy();
    expect(within(first).getByText(/I built a three-bedroom house/)).toBeTruthy();
    expect(
      within(first).getByRole('button', { name: 'Download bill-of-quantities.pdf' }),
    ).toBeTruthy();
    expect(button('Mark resolved')).toBeTruthy();
    expect(button('Raise follow-up')).toBeTruthy();
    expect(button('Withdraw')).toBeNull();
  });

  it('shows an on-time response', async () => {
    renderDetail(await detailOf(CASES.mine, K.onTime));
    expect(screen.getByText('Responded on time')).toBeTruthy();
  });

  it('says an overdue clarification can still be answered, and offers only withdraw', async () => {
    renderDetail(await detailOf(CASES.mine, K.overdue));
    expect(screen.getByText('Overdue since 25 Sep 2026.')).toBeTruthy();
    expect(
      screen.getByText(
        'Not answered by the due date. The declarant can still respond; the response will be marked late.',
      ),
    ).toBeTruthy();
    expect(button('Mark resolved')).toBeNull();
    expect(button('Raise follow-up')).toBeNull();
    expect(button('Withdraw')).toBeTruthy();
    expect(screen.getByText('Marked overdue')).toBeTruthy();
  });

  it('is read-only on a case someone else holds, and tells a supervisor to reassign', async () => {
    renderDetail(await detailOf(CASES.peters, K.petersOverdue), true);
    expect(screen.getByText(/Peter Mwangi holds this case\. Reassign it to act\./)).toBeTruthy();
    expect(button('Mark resolved')).toBeNull();
    expect(button('Withdraw')).toBeNull();
    expect(button('Raise follow-up')).toBeNull();
  });

  it('shows a resolved clarification with its note', async () => {
    renderDetail(await detailOf(CASES.mine, K.resolved));
    expect(screen.getByText('Resolved 15 Aug 2026.')).toBeTruthy();
    expect(screen.getByText('Loan statement matches the payslip deduction.')).toBeTruthy();
    expect(button('Mark resolved')).toBeNull();
    expect(button('Raise follow-up')).toBeNull();
  });

  it('shows a withdrawn clarification with its letter revoked', async () => {
    renderDetail(await detailOf(CASES.mine, K.withdrawn));
    expect(screen.getByText('Withdrawn.')).toBeTruthy();
    expect(screen.getByText('Letter revoked as issued in error; no response needed.')).toBeTruthy();
    expect(screen.getByText('Revoked')).toBeTruthy();
    expect(screen.getByText('Withdrawn before a response.')).toBeTruthy();
    expect(button('Mark resolved')).toBeNull();
  });

  it('disables a follow-up once the clarification window has closed', async () => {
    renderDetail(await detailOf(CASES.windowClosed, K.closedWindow));
    expect((button('Raise follow-up') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ClarificationDetailView: drafts and the letter (#170)', () => {
  it('names each item from the declaration as filed', async () => {
    renderDetail(await detailOf(CASES.mine, K.issued));
    const items = screen.getByRole('list', { name: 'Items and responses' });
    expect(
      within(items).getByText('Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno'),
    ).toBeTruthy();
    expect(within(items).getByText('Financial statement · John Kennedy Otieno')).toBeTruthy();
  });

  it('continues a draft in the composer, for the reviewer holding the case', async () => {
    renderDetail(await detailOf(CASES.mine, K.draft));
    expect(screen.getByText('Not sent.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue draft' }));
    const drawer = screen.getByRole('dialog', { name: 'Clarification draft' });
    expect(
      within(drawer).getByRole('button', {
        name: 'What is this about? Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
      }),
    ).toBeTruthy();
  });

  it('looks again while the letter is being produced', async () => {
    const detail = await detailOf(CASES.mine, K.issued);
    vi.useFakeTimers();
    try {
      renderDetail({
        ...detail,
        clarification: {
          ...detail.clarification,
          letter: { documentId: K.issued, verificationId: 'pending', status: 'pending' },
        },
      });
      expect(screen.getByText('Producing the letter…')).toBeTruthy();
      expect(button('Show letter')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(LETTER_REFRESH_MS);
      });
      expect(invalidate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a draft straight in the composer after Raise follow-up', async () => {
    const detail = await detailOf(CASES.mine, K.draft);
    render(
      <TooltipProvider>
        <ToastProvider>
          <ClarificationDetailView
            detail={detail}
            now={NOW}
            supervisor={false}
            commission={{ name: 'Teachers Service Commission', issuerCode: 'TSC' }}
            compose
          />
        </ToastProvider>
      </TooltipProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Clarification draft' })).toBeTruthy();
  });

  it('labels the items and opening drafted with AI, and the letter says so (ADR-007)', async () => {
    renderDetail(await detailOf(CASES.mine, K.issued));
    const [first, second] = screen
      .getAllByRole('listitem')
      .filter((each) => each.textContent.includes('What we asked'));
    if (!first || !second) throw new Error('no items');
    expect(within(first).getByRole('img', { name: /^AI-assisted\./ })).toBeTruthy();
    expect(within(second).queryByRole('img', { name: /^AI-assisted/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show letter' }));
    const letter = screen.getByRole('article', { name: 'Letter preview' });
    expect(within(letter).getByText(/drafted with AI assistance/)).toBeTruthy();
  });

  it('shows the issued letter on request', async () => {
    renderDetail(await detailOf(CASES.mine, K.issued));
    expect(screen.queryByRole('article', { name: 'Letter preview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show letter' }));
    const letter = screen.getByRole('article', { name: 'Letter preview' });
    expect(within(letter).getByText('CLR-TSC-2026-0000042-K')).toBeTruthy();
    expect(within(letter).getByText('V-0042-7K2Q')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide letter' }));
    expect(screen.queryByRole('article', { name: 'Letter preview' })).toBeNull();
  });
});

describe('ClarificationDetailView: actions (S15)', () => {
  it('resolves with a required note and says what happens to the case', async () => {
    const detail = await detailOf(CASES.mine, K.late);
    renderDetail(detail);
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark clarification resolved' });
    expect(
      within(dialog).getByText(
        '3 other clarifications still open. The case stays awaiting clarification.',
      ),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));
    expect(
      within(dialog).getByText('Add a note so colleagues know why it is resolved.'),
    ).toBeTruthy();
    expect(resolveMock).not.toHaveBeenCalled();

    resolveMock.mockResolvedValue({
      ok: true,
      data: { ...detail.clarification, status: 'resolved' },
    });
    fireEvent.change(within(dialog).getByLabelText('Resolution note'), {
      target: { value: ' House built with the SACCO loan; statement attached. ' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));
      await Promise.resolve();
    });
    expect(resolveMock).toHaveBeenCalledWith({
      data: {
        clarificationId: K.late,
        note: 'House built with the SACCO loan; statement attached.',
      },
    });
    expect(screen.getByText('Clarification resolved')).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open with the error when saving fails', async () => {
    renderDetail(await detailOf(CASES.mine, K.late));
    resolveMock.mockResolvedValue({ ok: false, error: { kind: 'unavailable', detail: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Resolution note'), {
      target: { value: 'Fine' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));
      await Promise.resolve();
    });
    expect(within(dialog).getByText('We could not save this. Try again.')).toBeTruthy();
  });

  it('raises a further clarification and opens its draft', async () => {
    renderDetail(await detailOf(CASES.mine, K.late));
    const draftId = 'd2af7000-0000-4000-8000-000000000001';
    followUpMock.mockResolvedValue({
      ok: true,
      data: { ...(await detailOf(CASES.mine, K.late)).clarification, id: draftId, status: 'draft' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Raise follow-up' }));
      await Promise.resolve();
    });
    expect(followUpMock).toHaveBeenCalledWith({ data: { clarificationId: K.late } });
    expect(screen.getByText('Further clarification saved as a draft')).toBeTruthy();
    expect(navigate).toHaveBeenCalledWith({
      to: '/review/cases/$caseId/clarifications/$clarificationId',
      params: { caseId: CASES.mine, clarificationId: draftId },
      search: { compose: true },
    });
  });

  it('withdraws with a required reason', async () => {
    const detail = await detailOf(CASES.mine, K.issued);
    renderDetail(detail);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog', { name: 'Withdraw this clarification?' });
    expect(within(dialog).getByText('The reminder and overdue steps stop.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw clarification' }));
    expect(within(dialog).getByText('Give a reason. It is kept with the record.')).toBeTruthy();

    withdrawMock.mockResolvedValue({
      ok: true,
      data: { ...detail.clarification, status: 'withdrawn' },
    });
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Issued against the wrong item' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw clarification' }));
      await Promise.resolve();
    });
    expect(withdrawMock).toHaveBeenCalledWith({
      data: { clarificationId: K.issued, reason: 'Issued against the wrong item' },
    });
    expect(screen.getByText('Clarification withdrawn')).toBeTruthy();
  });

  it('reloads when the service says the page is out of date (403 or 409)', async () => {
    renderDetail(await detailOf(CASES.mine, K.issued));
    withdrawMock.mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Not issued', status: 409 },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Wrong' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw clarification' }));
      await Promise.resolve();
    });
    expect(screen.getByText('This clarification has changed. Reload to see it.')).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
  });

  it('reloads when a follow-up is refused because the page is out of date', async () => {
    renderDetail(await detailOf(CASES.mine, K.late));
    followUpMock.mockResolvedValue({
      ok: false,
      error: { kind: 'problem', problem: { type: 'about:blank', title: 'Forbidden', status: 403 } },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Raise follow-up' }));
      await Promise.resolve();
    });
    expect(screen.getByText('Only the reviewer holding the case can do this.')).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
