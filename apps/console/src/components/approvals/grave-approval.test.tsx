// @vitest-environment jsdom
/**
 * The approvals inbox's salary stoppage and disciplinary referral (spec 08 FE-3, #208; S6, S10,
 * US 13): what came before read from the ladder in the approve dialog, the read confirmation
 * before a salary is stopped, and what approving or declining a referral does.
 */
import { SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalsLoad } from '../../server/approvals';
import { loadApprovals } from '../../server/approvals.server';
import { mockReviewClient, resetReviewMock } from '../../server/review/mock.server';
import { getLadder } from '../../server/actions';
import { MOCK_LADDER_IDS as L } from '../../server/review/actions-mock.server';
import type { Assignee } from '../../server/review/types';
import { ApprovalsView } from './approvals-view';

const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const NOW_MS = Date.parse('2026-10-02T09:00:00Z');

const harness = { reload: () => Promise.resolve() };
const invalidate = vi.fn(() => harness.reload());

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    search?: unknown;
    children: ReactNode;
  }) => {
    let href = to;
    for (const [name, value] of Object.entries(params ?? {}))
      href = href.replace(`$${name}`, value);
    if (search && typeof search === 'object' && 'kind' in search)
      href += `?kind=${String(search.kind)}`;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  useRouter: () => ({ invalidate }),
}));

const client = () => mockReviewClient(ME.subject, ME.name, [SUPERVISOR]);

vi.mock('../../server/actions', async () => {
  const server = await import('../../server/actions.server');
  interface Data<T> {
    data: T;
  }
  return {
    approveLadderStep: vi.fn(({ data }: Data<{ actionId: string; idempotencyKey: string }>) =>
      server.approveStep(client(), data.actionId, data.idempotencyKey),
    ),
    declineLadderStep: vi.fn(
      ({ data }: Data<{ actionId: string; note: string; idempotencyKey: string }>) =>
        server.declineStep(client(), data.actionId, data.note, data.idempotencyKey),
    ),
    getLadder: vi.fn(({ data }: Data<{ ladderId: string }>) =>
      server.loadLadder(client(), data.ladderId),
    ),
  };
});
// The determinations tab's calls are server functions too; this file tests actions.
vi.mock('../../server/determinations', () => ({
  approveCaseDetermination: vi.fn(),
  returnCaseDetermination: vi.fn(),
}));
vi.mock('../../server/approvals', async () => {
  const server = await import('../../server/approvals.server');
  interface Data<T> {
    data: T;
  }
  return {
    getSupervisors: vi.fn(() => server.loadSupervisors(client(), 'tsc', ME.subject)),
    reassignToSupervisor: vi.fn(
      ({ data }: Data<{ kind: 'action'; subjectId: string; toSupervisor: string }>) =>
        server.reassignApproval(client(), data.kind, data.subjectId, data.toSupervisor),
    ),
  };
});

async function inbox(): Promise<ApprovalsLoad> {
  return {
    ...(await loadApprovals(client(), 'tsc', { kind: 'action' })),
    now: new Date(NOW_MS).toISOString(),
  };
}

function Harness({ initial }: { initial: ApprovalsLoad }) {
  const [load, setLoad] = useState(initial);
  useEffect(() => {
    harness.reload = async () => {
      const next = await inbox();
      act(() => {
        setLoad(next);
      });
    };
  }, []);
  return <ApprovalsView kind="action" load={load} viewer={ME} slug="tsc" paging={null} />;
}

async function open() {
  render(
    <ToastProvider>
      <TooltipProvider>
        <Harness initial={await inbox()} />
      </TooltipProvider>
    </ToastProvider>,
  );
}

function card(name: string): HTMLElement {
  const article = screen.getByRole('heading', { name: new RegExp(name) }).closest('article');
  if (!article) throw new Error(`No card for ${name}`);
  return article;
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
  invalidate.mockClear();
  vi.mocked(getLadder).mockClear();
});

async function approveDialog(name: string, title: string): Promise<HTMLElement> {
  fireEvent.click(within(card(name)).getByRole('button', { name: /^Approve( stoppage)?$/ }));
  return screen.findByRole('dialog', { name: title });
}

describe('approving a salary stoppage from the inbox (S6)', () => {
  it('reads the earlier steps from the ladder, and needs the supervisor to confirm reading them', async () => {
    await open();
    expect(
      within(card('Janet Achieng Odero')).getByRole('button', { name: 'Approve stoppage' }),
    ).toBeTruthy();
    const dialog = await approveDialog('Janet Achieng Odero', 'Approve salary stoppage');
    expect(vi.mocked(getLadder)).toHaveBeenCalledWith({ data: { ladderId: L.stoppageProposed } });
    expect(
      within(dialog).getByText(
        'Approving sends a stop-salary instruction to payroll for Janet Achieng Odero.',
      ),
    ).toBeTruthy();
    const before = await within(dialog).findByRole('list', { name: 'What came before' });
    expect(within(before).getAllByRole('listitem')).toHaveLength(2);
    expect(within(before).getAllByText('No response from the declarant')).toHaveLength(1);
    expect(within(before).getByText('KNH discharge summary.pdf')).toBeTruthy();
    expect(within(dialog).getByText(/personnel file number 20085562/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Approve and stop salary' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'I have read the notice, the warning and any responses',
      }),
    );
    fireEvent.click(confirm);
    expect(await screen.findByText(/^Salary stoppage approved\. ADM-TSC-2026-/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Janet Achieng Odero')).toBeNull();
    });
  });

  it('keeps approving off while the earlier steps cannot be read', async () => {
    vi.mocked(getLadder).mockResolvedValueOnce({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
    await open();
    const dialog = await approveDialog('Janet Achieng Odero', 'Approve salary stoppage');
    expect(await within(dialog).findByText('The earlier steps could not be loaded.')).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('list', { name: 'What came before' })).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox').disabled).toBe(false);
  });
});

describe('the disciplinary referral in the inbox (S10)', () => {
  it('shows the stoppage’s payroll acknowledgement and what the referral does', async () => {
    await open();
    const referral = card('Stephen Kiprotich Kosgei');
    // The notice and the warning went unanswered; the salary stoppage takes no response.
    expect(within(referral).getAllByText('No response from the declarant')).toHaveLength(2);
    expect(
      within(referral).getByText('The reporting entity is told to start disciplinary proceedings'),
    ).toBeTruthy();
    const dialog = await approveDialog('Stephen Kiprotich Kosgei', 'Approve disciplinary referral');
    const before = await within(dialog).findByRole('list', { name: 'What came before' });
    const stoppage = within(before).getByRole('region', { name: 'Stop-salary instruction' });
    expect(within(stoppage).getByText('Acknowledged')).toBeTruthy();
    expect(within(stoppage).getByText('PAY-ACK-2026-0091822')).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByText('Stephen Kiprotich Kosgei is notified')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and issue' }));
    expect(await screen.findByText(/^Disciplinary referral approved\. ADM-TSC-2026-/)).toBeTruthy();
  });

  it('declines it with a note: the salary stays stopped and the ladder waits', async () => {
    await open();
    fireEvent.click(
      within(card('Stephen Kiprotich Kosgei')).getByRole('button', { name: 'Decline' }),
    );
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
    expect(
      await screen.findByText('Disciplinary referral declined. The ladder waits for compliance.'),
    ).toBeTruthy();
  });
});
