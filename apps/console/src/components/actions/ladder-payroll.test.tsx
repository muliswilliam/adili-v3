// @vitest-environment jsdom
import { SUPERVISOR } from '@adili/roles';
import { formatDate, ToastProvider } from '@adili/ui';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

/**
 * The ladder page's salary stoppage and disciplinary referral (spec 08 FE-5, #208; S6, S7, S10):
 * payroll acknowledgements on the step cards and the stepper, and the supervisor's approve and
 * decline dialogs for the two grave steps.
 */

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const DAY = 86_400_000;

const supervisor = () =>
  mockReviewClient('f7a0c1de-0000-4000-8000-000000000021', 'Samuel Njoroge', [SUPERVISOR]);

function decisions(): LadderDecisions & { approve: ReturnType<typeof vi.fn> } {
  const client = supervisor();
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
  const result = await loadLadder(supervisor(), id);
  if (!result.ok) throw new Error('not ok');
  return result.data;
}

async function show(id: string, change: Partial<Ladder> = {}) {
  const made = decisions();
  render(
    <ToastProvider>
      <LadderDetailView
        ladder={{ ...(await ladder(id)), ...change }}
        now={NOW}
        supervisor
        decisions={made}
        onChanged={vi.fn()}
      />
    </ToastProvider>,
  );
  return made;
}

const stepper = () =>
  within(screen.getByRole('list', { name: 'Administrative action ladder' })).getAllByRole(
    'listitem',
  );

/** The stepper's salary stoppage, its third step. */
function stoppageStep(): HTMLElement {
  const step = stepper()[2];
  if (!step) throw new Error('no stoppage step');
  return step;
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});
afterEach(cleanup);

describe('payroll acknowledgements on the ladder (S6, S7, S15)', () => {
  it('says the stop-salary instruction waits for payroll while it is unacknowledged', async () => {
    await show(L.payrollPending);
    const card = screen.getByRole('region', { name: /Salary stoppage/ });
    const instruction = within(card).getByRole('region', { name: 'Stop-salary instruction' });
    expect(within(instruction).getByText('Waiting for payroll')).toBeTruthy();
    expect(within(instruction).getByText('stop_salary')).toBeTruthy();
    expect(within(instruction).getByText('Not yet')).toBeTruthy();
    expect(
      within(instruction).getByText(
        /The salary is not stopped and no letter is issued until then\./,
      ),
    ).toBeTruthy();
    expect(within(stoppageStep()).getByText('Waiting for payroll')).toBeTruthy();
    expect(
      within(stoppageStep()).getByText(
        `Approved ${formatDate(new Date(NOW_MS - DAY).toISOString())}`,
      ),
    ).toBeTruthy();
  });

  it('shows payroll’s acknowledgement of a stopped salary', async () => {
    await show(L.disciplinaryProposed);
    const card = screen.getByRole('region', { name: /Salary stoppage/ });
    const instruction = within(card).getByRole('region', { name: 'Stop-salary instruction' });
    expect(within(instruction).getByText('Acknowledged')).toBeTruthy();
    expect(within(instruction).getByText('PAY-ACK-2026-0091822')).toBeTruthy();
    expect(within(card).getByText('Salary stopped')).toBeTruthy();
    expect(within(card).getByText('Stoppage window ends')).toBeTruthy();
    const stopped = formatDate(new Date(NOW_MS - 33 * DAY).toISOString());
    expect(within(stoppageStep()).getByText(`Payroll acknowledged ${stopped}`)).toBeTruthy();
  });

  it('shows the reinstatement acknowledged when the declarant complied', async () => {
    await show(L.reinstated);
    const card = screen.getByRole('region', { name: /Salary stoppage/ });
    expect(within(card).getByRole('region', { name: 'Stop-salary instruction' })).toBeTruthy();
    const resume = within(card).getByRole('region', { name: 'Reinstatement instruction' });
    expect(within(resume).getByText('resume_salary')).toBeTruthy();
    expect(within(resume).getByText('PAY-ACK-2026-0093310')).toBeTruthy();
    const reinstated = formatDate(new Date(NOW_MS - 5 * DAY).toISOString());
    expect(screen.getByText(`Salary reinstatement acknowledged ${reinstated}.`)).toBeTruthy();
    expect(
      within(stoppageStep()).getByText(`Reinstatement acknowledged ${reinstated}`),
    ).toBeTruthy();
  });
});

describe('a ladder that ended without compliance (S7)', () => {
  it('still says the reinstatement was acknowledged', async () => {
    await show(L.reinstated, { status: 'ended', closingCause: 'obligation-cancelled' });
    const reinstated = formatDate(new Date(NOW_MS - 5 * DAY).toISOString());
    expect(screen.getByText(`Salary reinstatement acknowledged ${reinstated}.`)).toBeTruthy();
  });
});

describe('approving and declining the grave steps on the ladder (S6, S10)', () => {
  it('approves a salary stoppage once the supervisor has read what came before', async () => {
    const made = await show(L.stoppageProposed);
    const card = screen.getByRole('region', { name: /Salary stoppage/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve salary stoppage' });
    expect(
      within(dialog).getByText(
        'Approving sends a stop-salary instruction to payroll for Janet Achieng Odero.',
      ),
    ).toBeTruthy();
    const before = within(dialog).getByRole('list', { name: 'What came before' });
    expect(within(before).getAllByRole('listitem')).toHaveLength(2);
    expect(within(before).getByText(/approved by Mercy Wambui/)).toBeTruthy();
    expect(within(dialog).getByText('Payroll receives a stop_salary instruction')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Approve and stop salary' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'I have read the notice, the warning and any responses',
      }),
    );
    fireEvent.click(confirm);
    expect(await screen.findByText(/^Salary stoppage approved: ADM-TSC-2026-/)).toBeTruthy();
    expect(made.approve).toHaveBeenCalledTimes(1);
    const after = await ladder(L.stoppageProposed);
    expect(after.steps[2]?.payrollStop).toMatchObject({
      action: 'stop_salary',
      status: 'accepted',
    });
  });

  it('states what a disciplinary referral does, with the stoppage’s acknowledgement before it', async () => {
    await show(L.disciplinaryProposed);
    const card = screen.getByRole('region', { name: /Disciplinary referral/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve disciplinary referral' });
    const before = within(dialog).getByRole('list', { name: 'What came before' });
    expect(within(before).getByText('PAY-ACK-2026-0091822')).toBeTruthy();
    expect(
      within(dialog).getByText('The reporting entity is told to start disciplinary proceedings'),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/must act by/)).toBeNull();
    // No message goes out for a referral (S10): only the letter and the reporting entity's event.
    expect(within(dialog).queryByText(/is notified/)).toBeNull();
    expect(within(dialog).getByText(/finds it under Notices in the portal/)).toBeTruthy();
  });

  it('says a declined disciplinary referral leaves the salary stopped and the ladder waiting', async () => {
    await show(L.disciplinaryProposed);
    const card = screen.getByRole('region', { name: /Disciplinary referral/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline disciplinary referral' });
    expect(
      within(dialog).getByText(
        'Declining keeps the ladder open: it waits for compliance, and a stopped salary stays stopped until then.',
      ),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'TSC has started proceedings already.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Disciplinary referral declined')).toBeTruthy();
    expect(screen.getByText('The ladder waits for compliance.')).toBeTruthy();
  });
});
