// @vitest-environment jsdom
import { SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type CaseView, loadCaseView } from '../../server/review-case.server';
import {
  MOCK_CASE_IDS as CASES,
  mockReviewClient,
  resetReviewMock,
} from '../../server/review/mock.server';
import type { Assignee } from '../../server/review/types';
import { proposeCaseDetermination, withdrawCaseDetermination } from '../../server/determinations';
import { DeterminationPage } from './determination-page';

const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const SUP: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Samuel Njoroge' };
const NOW_MS = Date.parse('2026-10-02T09:00:00Z');

const harness = { reload: () => Promise.resolve() };
const invalidate = vi.fn(() => harness.reload());
const download = vi.fn();

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
  useRouter: () => ({ invalidate }),
}));

vi.mock('../download', () => ({
  downloadFrom: (url: string) => {
    download(url);
  },
}));

// The server functions, answered by the review mock as the signed-in officer.
const signedIn = { officer: ME, roles: ['reviewer'] as string[] };
vi.mock('../../server/determinations', async () => {
  const server = await import('../../server/determinations.server');
  const mock = await import('../../server/review/mock.server');
  const client = () =>
    mock.mockReviewClient(signedIn.officer.subject, signedIn.officer.name, signedIn.roles);
  interface Data<T> {
    data: T;
  }
  return {
    proposeCaseDetermination: vi.fn(
      ({
        data,
      }: Data<{
        caseId: string;
        input: Parameters<typeof server.proposeDetermination>[2];
        idempotencyKey: string;
      }>) => server.proposeDetermination(client(), data.caseId, data.input, data.idempotencyKey),
    ),
    withdrawCaseDetermination: vi.fn(({ data }: Data<{ determinationId: string }>) =>
      server.withdrawDetermination(client(), data.determinationId),
    ),
    getDecisionLetterLink: vi.fn(() =>
      Promise.resolve({ ok: true, data: { downloadUrl: '/api/mock-files/letter' } }),
    ),
  };
});

// Refer to EACC on the page (#211) is tested in components/referrals/refer-action.test.tsx.
vi.mock('../../server/referrals', () => ({ proposeCaseReferral: vi.fn() }));

async function viewOf(caseId: string, officer: Assignee): Promise<CaseView> {
  const result = await loadCaseView(
    mockReviewClient(officer.subject, officer.name),
    caseId,
    officer,
  );
  if (!result.ok) throw new Error('case');
  return result.data;
}

/** The page as its route shows it: read again on invalidate. */
function Harness({
  initial,
  caseId,
  supervisor,
}: {
  initial: CaseView;
  caseId: string;
  supervisor: boolean;
}) {
  const [load, setLoad] = useState(initial);
  useEffect(() => {
    harness.reload = async () => {
      const next = await viewOf(caseId, initial.viewer);
      act(() => {
        setLoad(next);
      });
    };
  }, [caseId, initial.viewer]);
  return (
    <DeterminationPage load={load} supervisor={supervisor} newKey={() => crypto.randomUUID()} />
  );
}

async function open(caseId: string, { officer = ME, supervisor = false } = {}) {
  signedIn.officer = officer;
  signedIn.roles = supervisor ? [SUPERVISOR] : ['reviewer'];
  const initial = await viewOf(caseId, officer);
  render(
    <ToastProvider>
      <TooltipProvider>
        <Harness initial={initial} caseId={caseId} supervisor={supervisor} />
      </TooltipProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
  invalidate.mockClear();
  download.mockClear();
});

describe('DeterminationPage (spec 08 FE-2)', () => {
  it('lets the assignee propose: validation first, then awaiting approval with Withdraw (S1)', async () => {
    await open(CASES.ready);
    expect(screen.getByText('No determination yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Propose determination' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose for approval' }));
    expect(within(dialog).getByText('Choose a determination.')).toBeTruthy();
    expect(within(dialog).getByText('Enter your reasons.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Further action' }));
    fireEvent.change(within(dialog).getByLabelText('Reasons'), {
      target: { value: 'A directorship is left out.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose for approval' }));
    expect(within(dialog).getByText('Say what further action is needed.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Further action' }), {
      target: { value: 'Refer to EACC.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose for approval' }));

    expect(
      await screen.findByText(/Determination proposed by Faith Achieng on .*, awaiting approval/),
    ).toBeTruthy();
    expect(screen.getByText('Proposed by Faith Achieng: Further action')).toBeTruthy();
    expect(screen.getByText('Refer to EACC.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Propose determination' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw proposal' }));
    expect(await screen.findByText('Withdrawn by Faith Achieng')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Propose determination' })).toBeTruthy();
  });

  it('keeps the text and says why when someone proposed first (409 determination-open)', async () => {
    await open(CASES.ready);
    fireEvent.click(screen.getByRole('button', { name: 'Propose determination' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Compliant' }));
    fireEvent.change(within(dialog).getByLabelText('Reasons'), {
      target: { value: 'All flags reviewed and explained.' },
    });
    // Another tab proposes for the same assignee meanwhile.
    const { proposeDetermination } = await import('../../server/determinations.server');
    await proposeDetermination(
      mockReviewClient(ME.subject, ME.name),
      CASES.ready,
      { outcome: 'non-compliant', reasons: 'Elsewhere.' },
      crypto.randomUUID(),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose for approval' }));
    expect(
      await within(dialog).findByText('A determination is already proposed for this case'),
    ).toBeTruthy();
    expect(within(dialog).getByText('409 determination-open')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Reasons').value).toBe(
      'All flags reviewed and explained.',
    );
  });

  it('asks the assignee to settle an open clarification before proposing', async () => {
    await open(CASES.mine);
    // The banner says so up front; the page offers no Propose while a clarification is open.
    expect(screen.getByText('A clarification is still open')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Propose determination' })).toBeNull();
  });

  it('shows a returned proposal with the reason, and Revise starts from it (S2)', async () => {
    await open(CASES.returned);
    expect(screen.getByText(/Returned by Lucy Wambui on/)).toBeTruthy();
    expect(screen.getByText(/41% land value change/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revise determination' });
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Reasons').value).toBe(
      'All flags reviewed. Registry checks match.',
    );
    expect(within(dialog).getByText('Lucy Wambui returned it:')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reasons'), {
      target: { value: 'The valuation report VR-2291 explains the 41% change.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose for approval' }));
    expect(
      await screen.findByText(/Determination proposed by Faith Achieng on .*, awaiting approval/),
    ).toBeTruthy();
  });

  it('shows the approved determination with its CMP reference and the decision letter', async () => {
    await open(CASES.determined);
    expect(screen.getByText('Determined: Compliant')).toBeTruthy();
    expect(
      screen.getByText(/Approved by Lucy Wambui on .*Letter issued and declarant notified/),
    ).toBeTruthy();
    expect(screen.getAllByText(/^CMP-TSC-\d{4}-\d{7}-[A-Z0-9]$/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Decision letter' }));
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledWith('/api/mock-files/letter');
    });
  });

  it('tells anyone else who may propose: nobody until the case is claimed', async () => {
    await open(CASES.unassigned, { officer: SUP, supervisor: true });
    expect(screen.getByText('Nobody holds this case yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Propose determination' })).toBeNull();
  });

  it('names the system as proposer of a bulk closure, with no way to the inbox', async () => {
    await open(CASES.bulkClosure, { officer: SUP, supervisor: true });
    expect(
      screen.getByText(/^Determination proposed by the system on .*, awaiting approval$/),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open in Approvals' })).toBeNull();
  });

  it('offers a supervisor the proposal in Approvals', async () => {
    await open(CASES.peters, { officer: SUP, supervisor: true });
    expect(
      screen.getByText(/Determination proposed by Peter Mwangi on .*, awaiting approval/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Approvals' }).getAttribute('href')).toBe(
      '/approvals',
    );
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it.each([
    [{ kind: 'not-the-proposer' } as const, 'Only the reviewer who proposed it can withdraw it'],
    [{ kind: 'not-proposed' } as const, 'This proposal was decided already'],
  ])('says why a withdrawal was refused (%o)', async (refusal, text) => {
    await proposeOnReady();
    vi.mocked(withdrawCaseDetermination).mockResolvedValueOnce({ ok: false, refusal });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw proposal' }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
  });

  it('keeps the text when the session has ended', async () => {
    await open(CASES.ready);
    vi.mocked(proposeCaseDetermination).mockResolvedValueOnce({
      ok: false,
      refusal: null,
      error: { kind: 'unauthenticated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Propose determination' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Compliant' }));
    fireEvent.change(within(dialog).getByLabelText('Reasons'), { target: { value: 'Seen.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose for approval' }));
    expect(await within(dialog).findByText('Your session has ended. Sign in again.')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Reasons').value).toBe('Seen.');
  });
});

/** Opens the ready case with a proposal of the viewer's awaiting approval. */
async function proposeOnReady() {
  const { proposeDetermination } = await import('../../server/determinations.server');
  await proposeDetermination(
    mockReviewClient(ME.subject, ME.name),
    CASES.ready,
    { outcome: 'compliant', reasons: 'All flags reviewed.' },
    crypto.randomUUID(),
  );
  await open(CASES.ready);
}
