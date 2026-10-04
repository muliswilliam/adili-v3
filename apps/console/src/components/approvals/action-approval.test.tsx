// @vitest-environment jsdom
import { REVIEWER, SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalsLoad } from '../../server/approvals';
import { loadApprovals } from '../../server/approvals.server';
import { mockReviewClient, resetReviewMock } from '../../server/review/mock.server';
import {
  MOCK_LADDER_IDS as L,
  MOCK_LADDER_OFFICERS,
} from '../../server/review/actions-mock.server';
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

/** The viewer's roles when a decision call goes out; a test may take supervisor away. */
const viewer = { roles: [SUPERVISOR] as string[] };
const client = () => mockReviewClient(ME.subject, ME.name, viewer.roles);

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
// The determinations and referrals tabs' calls are server functions too; this file tests actions.
vi.mock('../../server/determinations', () => ({
  approveCaseDetermination: vi.fn(),
  returnCaseDetermination: vi.fn(),
}));
vi.mock('../../server/referrals', () => ({
  approveCaseReferral: vi.fn(),
  declineCaseReferral: vi.fn(),
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
  viewer.roles = [SUPERVISOR];
  resetReviewMock(NOW_MS);
  invalidate.mockClear();
});

describe('Approvals inbox, actions tab (spec 08 FE-3, S14)', () => {
  it('lists the drafted ladder steps with what the ladder is about', async () => {
    await open();
    expect(screen.getByRole('link', { name: /Actions\s*10/ })).toBeTruthy();
    const notice = card('Nancy Wairimu Muriuki');
    expect(within(notice).getByText('Notice to comply')).toBeTruthy();
    expect(within(notice).getByText('Initial declaration')).toBeTruthy();
    expect(within(notice).getByText('File 20260318')).toBeTruthy();
    expect(
      within(notice).getByText('No earlier steps. This is the first step of the ladder.'),
    ).toBeTruthy();
    expect(
      within(notice)
        .getByRole('link', { name: /Open ladder/ })
        .getAttribute('href'),
    ).toBe(`/actions/${L.noticeProposed}`);
  });

  it('shows the steps before a warning, and why a reviewer of record cannot approve (S9)', async () => {
    await open();
    const warning = card('Lydia Moraa Nyakundi');
    const earlier = within(warning).getByRole('list', { name: 'Earlier steps' });
    expect(within(earlier).getByText('Notice to comply')).toBeTruthy();
    expect(within(earlier).getByText(/^ADM-TSC-2026-\d{7}-[0-9A-Z]$/)).toBeTruthy();
    expect(within(earlier).getByText(/^Issued /)).toBeTruthy();
    expect(within(earlier).getByText('No response from the declarant')).toBeTruthy();
    expect(within(warning).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(
      within(warning).getByRole('button', { name: 'Reassign to another supervisor' }),
    ).toBeTruthy();
  });

  it('approves a notice after stating what follows (S5)', async () => {
    await open();
    fireEvent.click(within(card('Nancy Wairimu Muriuki')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve notice to comply' });
    expect(within(dialog).getByText('An ADM number is allocated in your name')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and issue' }));
    expect(
      await screen.findByText(
        /^Notice to comply approved\. ADM-TSC-\d{4}-\d{7}-[0-9A-Z] allocated\.$/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Nancy Wairimu Muriuki/ })).toBeNull();
  });

  it('declines a step only with a note (S8)', async () => {
    await open();
    fireEvent.click(within(card('Nancy Wairimu Muriuki')).getByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline notice to comply' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(within(dialog).getByText('Say why you are declining.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'Filed on paper at the county office.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(
      await screen.findByText('Notice to comply declined. The ladder has ended.'),
    ).toBeTruthy();
  });

  it('says so when someone else decided first (409 not-proposed)', async () => {
    await open();
    const { approveStep } = await import('../../server/actions.server');
    const items = await loadApprovals(client(), 'tsc', { kind: 'action' });
    const nancy = items.ok
      ? items.data.items.find(
          (item) => item.kind === 'action' && item.summary.ladderId === L.noticeProposed,
        )
      : undefined;
    if (!nancy) throw new Error('no item');
    await approveStep(
      mockReviewClient(MOCK_LADDER_OFFICERS.samuel.subject, 'Samuel Njoroge', [SUPERVISOR]),
      nancy.subjectId,
      crypto.randomUUID(),
    );
    fireEvent.click(within(card('Nancy Wairimu Muriuki')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve notice to comply' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and issue' }));
    const notice = await screen.findByRole('dialog', { name: 'Already decided' });
    expect(within(notice).getByText('409 not-proposed')).toBeTruthy();
  });

  it('explains a supervisor-required refusal, without Reassign (403)', async () => {
    await open();
    // The viewer loses the supervisor role after the inbox loaded.
    viewer.roles = [REVIEWER];
    fireEvent.click(
      within(card('Janet Achieng Odero')).getByRole('button', { name: 'Approve stoppage' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Approve salary stoppage' });
    expect(within(dialog).getByText('Payroll receives a stop_salary instruction')).toBeTruthy();
    await within(dialog).findByRole('list', { name: 'What came before' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and stop salary' }));
    const notice = await screen.findByRole('dialog', { name: 'You cannot approve this' });
    expect(within(notice).getByText('Only a supervisor can approve this step.')).toBeTruthy();
    expect(within(notice).getByText('403 supervisor-required')).toBeTruthy();
    expect(
      within(notice).queryByRole('button', { name: 'Reassign to another supervisor' }),
    ).toBeNull();
  });
});
