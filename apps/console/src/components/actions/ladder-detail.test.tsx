// @vitest-environment jsdom
import { REVIEWER, SUPERVISOR } from '@adili/roles';
import { ToastProvider } from '@adili/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  approveStep,
  declineStep,
  type Ladder,
  loadLadder,
  restartLadder,
} from '../../server/actions.server';
import { MOCK_LADDER_IDS as L } from '../../server/review/actions-mock.server';
import { mockReviewClient, resetReviewMock } from '../../server/review/mock.server';
import { type LadderDecisions, LadderDetailView } from './ladder-detail';
import { consequencesOf, DeclineStepDialog } from './step-dialogs';

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';

function clientFor(supervisor: boolean) {
  return supervisor
    ? mockReviewClient('f7a0c1de-0000-4000-8000-000000000021', 'Samuel Njoroge', [SUPERVISOR])
    : mockReviewClient(ME, 'Grace Wanjiru', [REVIEWER]);
}

function decisionsFor(
  supervisor: boolean,
): LadderDecisions & { [K in keyof LadderDecisions]: ReturnType<typeof vi.fn> } {
  const client = clientFor(supervisor);
  return {
    approve: vi.fn((actionId: string, key: string) => approveStep(client, actionId, key)),
    decline: vi.fn((actionId: string, note: string, key: string) =>
      declineStep(client, actionId, note, key),
    ),
    restart: vi.fn((ladderId: string, key: string) => restartLadder(client, ladderId, key)),
    letterLink: vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { downloadUrl: '/x.pdf' } }),
    ),
  };
}

async function ladder(id: string): Promise<Ladder> {
  const result = await loadLadder(clientFor(true), id);
  if (!result.ok) throw new Error('not ok');
  return result.data;
}

async function show(id: string, { supervisor = false } = {}) {
  const decisions = decisionsFor(supervisor);
  const onChanged = vi.fn();
  render(
    <ToastProvider>
      <LadderDetailView
        ladder={await ladder(id)}
        now={NOW}
        supervisor={supervisor}
        decisions={decisions}
        onChanged={onChanged}
      />
    </ToastProvider>,
  );
  return { decisions, onChanged };
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});
afterEach(cleanup);

describe('LadderDetailView', () => {
  it('shows a drafted notice on the stepper, waiting for approval', async () => {
    await show(L.noticeProposed);
    expect(screen.getByRole('heading', { level: 1, name: 'Nancy Wairimu Muriuki' })).toBeTruthy();
    expect(screen.getByText('Declaration overdue')).toBeTruthy();
    const stepper = screen.getByRole('list', { name: 'Administrative action ladder' });
    const steps = within(stepper).getAllByRole('listitem');
    expect(steps.map((step) => step.dataset.status)).toEqual([
      'awaiting',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    const card = screen.getByRole('region', { name: /Notice to comply/ });
    expect(within(card).getByText('Number on approval')).toBeTruthy();
    expect(within(card).getByText('A reviewer or supervisor')).toBeTruthy();
  });

  it('approves the notice after stating what follows (S5)', async () => {
    const { decisions, onChanged } = await show(L.noticeProposed);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve notice to comply' });
    expect(within(dialog).getByText('An ADM number is allocated in your name')).toBeTruthy();
    expect(within(dialog).getByText('The declarant must act by 12 Oct 2026')).toBeTruthy();
    expect(within(dialog).getByText('Nancy Wairimu Muriuki is notified')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and issue' }));
      await Promise.resolve();
    });
    expect(decisions.approve).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByText(/^Notice to comply approved: ADM-TSC-2026-/)).toBeTruthy();
  });

  it('declines the notice only with a note (S8)', async () => {
    const { decisions, onChanged } = await show(L.noticeProposed);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const dialog = screen.getByRole('dialog', { name: 'Decline notice to comply' });
    expect(
      within(dialog).getByText('Declining ends this ladder. A supervisor can restart it.'),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
      await Promise.resolve();
    });
    expect(within(dialog).getByText('Say why you are declining.')).toBeTruthy();
    expect(decisions.decline).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'On approved study leave.' },
    });
    expect(within(dialog).getByText('24 / 2,000')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
      await Promise.resolve();
    });
    expect(decisions.decline).toHaveBeenCalledWith(
      expect.any(String),
      'On approved study leave.',
      expect.any(String),
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('tells a reviewer of record they cannot approve, after the service refuses', async () => {
    const { onChanged } = await show(L.warningBlocked);
    const card = screen.getByRole('region', { name: /Warning/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve and issue' }));
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(card).getByText('You cannot approve this: you reviewed this case.')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('keeps a salary stoppage for supervisors', async () => {
    await show(L.stoppageProposed);
    const card = screen.getByRole('region', { name: /Salary stoppage/ });
    expect(within(card).getByText('Only a supervisor can approve this step.')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(card).getByText('A supervisor')).toBeTruthy();
  });

  it('shows the declarant response beside the issued notice (S9)', async () => {
    await show(L.noticeResponded);
    const card = screen.getByRole('region', { name: /Notice to comply/ });
    expect(within(card).getByText(/I replied to the clarification by email/)).toBeTruthy();
    expect(within(card).getByText('Reply to clarification.pdf')).toBeTruthy();
    expect(within(card).getByText('Equity Bank statements Jan-Jun 2026.pdf')).toBeTruthy();
    expect(within(card).getByText('Responses do not pause the ladder.')).toBeTruthy();
    expect(within(card).getByText('Notice to comply letter')).toBeTruthy();
    expect(within(card).getByText('in 2 days')).toBeTruthy();
    const next = screen.getByText('Drafted 30 Sep 2026 if still not complied.');
    expect(next.previousElementSibling?.textContent).toBe('Warning');
  });

  it('lets a supervisor restart a declined ladder (S8)', async () => {
    const { decisions, onChanged } = await show(L.declined, { supervisor: true });
    expect(
      screen.getByText('Ladder ended: notice to comply declined by Peter Mwangi on 8 Sep 2026'),
    ).toBeTruthy();
    expect(screen.getByText(/The declarant is on approved study leave abroad/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart ladder' }));
    const dialog = screen.getByRole('dialog', { name: 'Restart this ladder?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Restart ladder' }));
      await Promise.resolve();
    });
    expect(decisions.restart).toHaveBeenCalledWith(L.declined, expect.any(String));
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('does not offer a reviewer the restart', async () => {
    await show(L.declined);
    expect(
      screen.getByText('Nothing more is drafted unless a supervisor restarts it.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restart ladder' })).toBeNull();
  });

  it('says how a complied ladder ended (S7)', async () => {
    await show(L.complied);
    expect(screen.getByText('Complied on 18 Sep 2026: declaration filed.')).toBeTruthy();
    const steps = within(
      screen.getByRole('list', { name: 'Administrative action ladder' }),
    ).getAllByRole('listitem');
    expect(steps.map((step) => step.dataset.status)).toEqual([
      'complied',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });

  it('says so when the ladder was restarted by someone else first (409 ladder-not-declined)', async () => {
    const { decisions, onChanged } = await show(L.declined, { supervisor: true });
    await restartLadder(clientFor(true), L.declined, crypto.randomUUID());
    fireEvent.click(screen.getByRole('button', { name: 'Restart ladder' }));
    const dialog = screen.getByRole('dialog', { name: 'Restart this ladder?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Restart ladder' }));
      await Promise.resolve();
    });
    expect(decisions.restart).toHaveBeenCalledOnce();
    expect(
      within(dialog).getByText('This ladder is no longer declined. It has been reloaded.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('409 ladder-not-declined')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledOnce();
  });
});

describe('step dialogs: what follows depends on the step', () => {
  it('a salary stoppage states the stop-salary instruction (S6)', () => {
    const titles = consequencesOf('salary-stoppage', 'Janet Achieng Odero', NOW).map(
      (each) => each.title,
    );
    expect(titles).toContain("The declarant's salary is stopped");
    expect(titles).toContain('The declarant must act by 28 Oct 2026');
  });

  it('declining a disciplinary referral keeps the ladder open (S10)', () => {
    render(
      <DeclineStepDialog
        open
        onOpenChange={vi.fn()}
        step="disciplinary-referral"
        declarantName="Janet Achieng Odero"
        onSubmit={vi.fn(() => Promise.resolve(null))}
      />,
    );
    expect(
      screen.getByText(
        'Declining keeps the ladder open: it waits for compliance, and a stopped salary stays stopped until then.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Declining ends this ladder/)).toBeNull();
  });
});
