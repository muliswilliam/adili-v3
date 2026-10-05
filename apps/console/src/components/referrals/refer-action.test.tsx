// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listReferrals, proposeReferral } from '../../server/referrals.server';
import { type CaseView, loadCaseView } from '../../server/review-case.server';
import {
  MOCK_CASE_IDS as CASES,
  mockReviewClient,
  resetReviewMock,
} from '../../server/review/mock.server';
import type { Assignee } from '../../server/review/types';
import { DeterminationPage } from '../determination/determination-page';

const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const NOW_MS = Date.parse('2026-10-02T09:00:00Z');

const navigate = vi.fn();
const invalidate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate, navigate }),
}));

// The determination page's own server functions are not used here.
vi.mock('../../server/determinations', () => ({
  proposeCaseDetermination: vi.fn(),
  withdrawCaseDetermination: vi.fn(),
  getDecisionLetterLink: vi.fn(),
}));

// The server functions, answered by the review mock as the signed-in reviewer.
vi.mock('../../server/referrals', async () => {
  const server = await import('../../server/referrals.server');
  const mock = await import('../../server/review/mock.server');
  return {
    proposeCaseReferral: vi.fn(
      ({
        data,
      }: {
        data: {
          caseId: string;
          input: Parameters<typeof server.proposeReferral>[2];
          idempotencyKey: string;
        };
      }) =>
        server.proposeReferral(
          mock.mockReviewClient(ME.subject, ME.name),
          data.caseId,
          data.input,
          data.idempotencyKey,
        ),
    ),
  };
});

const client = () => mockReviewClient(ME.subject, ME.name);

async function open(caseId: string) {
  const result = await loadCaseView(client(), caseId, ME);
  if (!result.ok) throw new Error('case');
  const load: CaseView = result.data;
  render(
    <ToastProvider>
      <TooltipProvider>
        <DeterminationPage load={load} supervisor={false} />
      </TooltipProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
  navigate.mockClear();
  invalidate.mockClear();
});

describe('Refer to EACC from the case (spec 08 FE-6, S13)', () => {
  it('checks the answers, then proposes the referral and opens it', async () => {
    await open(CASES.mine);
    fireEvent.click(screen.getByRole('button', { name: 'Refer to EACC' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refer to EACC' });
    // Only the registry and comparison flags are offered; lateness is not a ground.
    expect(within(dialog).getByRole('checkbox', { name: /Value changed by 150%/ })).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox', { name: /late/i })).toBeNull();
    // Drafts and withdrawn clarifications are not evidence.
    expect(within(dialog).queryByText('Draft')).toBeNull();
    expect(within(dialog).queryByText('Withdrawn')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose referral' }));
    expect(within(dialog).getByText('Choose the grounds.')).toBeTruthy();
    expect(
      within(dialog).getByText('Select at least one flag that supports the referral.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('Enter the narrative.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Undeclared assets' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Value changed by 150%/ }));
    const [clarification] = within(dialog).getAllByRole('checkbox', { name: /^CLR-/ });
    if (clarification) fireEvent.click(clarification);
    fireEvent.change(within(dialog).getByLabelText('Narrative'), {
      target: { value: 'The plot is valued 150% higher with no improvement recorded.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose referral' }));

    expect(await screen.findByText('Referral proposed for approval')).toBeTruthy();
    const listed = await listReferrals(client(), 'tsc', { status: 'proposed' });
    const created = listed.ok ? listed.data.items.find((each) => each.caseId === CASES.mine) : null;
    expect(created).toMatchObject({
      grounds: 'undeclared-assets',
      proposer: ME,
      sources: { flagIds: [expect.any(String)], clarificationIds: [expect.any(String)] },
    });
    expect(navigate).toHaveBeenCalledWith({
      to: '/referrals/$referralId',
      params: { referralId: created?.id },
    });
    expect(screen.queryByRole('dialog', { name: 'Refer to EACC' })).toBeNull();
  });

  it('keeps the answers and says why when one from the case already waits (409)', async () => {
    await open(CASES.mine);
    fireEvent.click(screen.getByRole('button', { name: 'Refer to EACC' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refer to EACC' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Unexplained assets' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Assets grew faster/ }));
    fireEvent.change(within(dialog).getByLabelText('Narrative'), {
      target: { value: 'Assets grew faster than income.' },
    });
    // Another tab refers the case meanwhile.
    await proposeReferral(
      client(),
      CASES.mine,
      {
        grounds: 'undeclared-assets',
        narrative: 'Elsewhere.',
        flagIds: ['f1a90000-0000-4000-8000-000000000001'],
        clarificationIds: [],
      },
      crypto.randomUUID(),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Propose referral' }));
    expect(
      await within(dialog).findByText('A referral from this case already waits for approval'),
    ).toBeTruthy();
    expect(within(dialog).getByText('409 referral-open')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Narrative').value).toBe(
      'Assets grew faster than income.',
    );
  });

  it('is not offered on a case the viewer does not hold', async () => {
    await open(CASES.peters);
    expect(screen.queryByRole('button', { name: 'Refer to EACC' })).toBeNull();
  });

  it('is not offered on a determined case', async () => {
    await open(CASES.determined);
    expect(screen.queryByRole('button', { name: 'Refer to EACC' })).toBeNull();
  });
});

describe('Start referral from the propose dialog (spec 08 FE-2, #610)', () => {
  async function proposeFurtherAction() {
    await open(CASES.ready);
    fireEvent.click(screen.getByRole('button', { name: 'Propose determination' }));
    const dialog = await screen.findByRole('dialog', { name: 'Propose determination' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Further action' }));
    fireEvent.change(within(dialog).getByLabelText('Reasons'), {
      target: { value: 'The plot is valued far above what was declared.' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Further action' }), {
      target: { value: 'Refer to EACC for the undeclared parcel.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start referral' }));
    return screen.findByRole('dialog', { name: 'Refer to EACC' });
  }

  function expectProposalKept(dialog: HTMLElement) {
    expect(
      within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Further action' }).checked,
    ).toBe(true);
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Reasons').value).toBe(
      'The plot is valued far above what was declared.',
    );
    expect(
      within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: 'Further action' }).value,
    ).toBe('Refer to EACC for the undeclared parcel.');
  }

  it('opens Refer to EACC and, once proposed, comes back to the proposal with its text', async () => {
    const refer = await proposeFurtherAction();
    expect(screen.queryByRole('dialog', { name: 'Propose determination' })).toBeNull();

    fireEvent.click(within(refer).getByRole('radio', { name: 'Undeclared assets' }));
    fireEvent.click(within(refer).getByRole('checkbox', { name: /Value changed by 150%/ }));
    fireEvent.change(within(refer).getByLabelText('Narrative'), {
      target: { value: 'The plot is valued 150% higher with no improvement recorded.' },
    });
    fireEvent.click(within(refer).getByRole('button', { name: 'Propose referral' }));

    expect(await screen.findByText('Referral proposed for approval')).toBeTruthy();
    const listed = await listReferrals(client(), 'tsc', { status: 'proposed' });
    expect(listed.ok ? listed.data.items.some((each) => each.caseId === CASES.ready) : false).toBe(
      true,
    );
    // The proposal is not finished: back to it, not to the referral, with the case read again.
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    expectProposalKept(await screen.findByRole('dialog', { name: 'Propose determination' }));
    expect(screen.queryByRole('dialog', { name: 'Refer to EACC' })).toBeNull();
  });

  it('goes back to the proposal, text kept, when the referral is cancelled', async () => {
    const refer = await proposeFurtherAction();
    fireEvent.click(within(refer).getByRole('button', { name: 'Cancel' }));
    expectProposalKept(await screen.findByRole('dialog', { name: 'Propose determination' }));
  });
});
