// @vitest-environment jsdom
import { SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalsLoad } from '../../server/approvals';
import { loadApprovals } from '../../server/approvals.server';
import { loadReferral } from '../../server/referrals.server';
import { reassign } from '../../server/review-case.server';
import {
  MOCK_CASE_IDS as CASES,
  mockReviewClient,
  resetReviewMock,
} from '../../server/review/mock.server';
import { MOCK_REFERRAL_IDS as R } from '../../server/review/referrals-mock.server';
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

vi.mock('../../server/determinations', () => ({
  approveCaseDetermination: vi.fn(),
  returnCaseDetermination: vi.fn(),
}));
vi.mock('../../server/referrals', async () => {
  const server = await import('../../server/referrals.server');
  interface Data<T> {
    data: T;
  }
  return {
    approveCaseReferral: vi.fn(({ data }: Data<{ referralId: string; idempotencyKey: string }>) =>
      server.approveReferral(client(), data.referralId, data.idempotencyKey),
    ),
    declineCaseReferral: vi.fn(({ data }: Data<{ referralId: string; note: string }>) =>
      server.declineReferral(client(), data.referralId, data.note),
    ),
  };
});
vi.mock('../../server/approvals', async () => {
  const server = await import('../../server/approvals.server');
  interface Data<T> {
    data: T;
  }
  return {
    getSupervisors: vi.fn(() => server.loadSupervisors(client(), 'tsc', ME.subject)),
    reassignToSupervisor: vi.fn(
      ({ data }: Data<{ kind: 'referral'; subjectId: string; toSupervisor: string }>) =>
        server.reassignApproval(client(), data.kind, data.subjectId, data.toSupervisor),
    ),
  };
});

async function inbox(): Promise<ApprovalsLoad> {
  return {
    ...(await loadApprovals(client(), 'tsc', { kind: 'referral' })),
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
  return <ApprovalsView kind="referral" load={load} viewer={ME} slug="tsc" paging={null} />;
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
});

describe('the referrals tab of the approvals inbox (spec 08 FE-3, FE-6)', () => {
  it('lists proposed referrals with their grounds, proposer and what they rest on', async () => {
    await open();
    expect(screen.getByRole('link', { name: /Referrals\s*5/ })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    const system = card('Stephen Mwangi Karanja');
    expect(within(system).getByText('Two missed cycles')).toBeTruthy();
    expect(within(system).getByText(/Proposed by\s*the system/)).toBeTruthy();
    expect(within(system).getByText('2 obligations')).toBeTruthy();
    expect(within(system).getByText('3 letters')).toBeTruthy();
    expect(within(system).getByRole('link', { name: 'Open referral' }).getAttribute('href')).toBe(
      `/referrals/${R.twoMissedCycles}`,
    );
  });

  it('says why the viewer cannot approve their own or their case’s referral', async () => {
    await open();
    const ofRecord = card('Esther Moraa Onyango');
    expect(within(ofRecord).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(ofRecord).getByText(/you reviewed this case/i)).toBeTruthy();
    expect(within(ofRecord).getByRole('button', { name: 'Reassign to another supervisor' }));
  });

  it('states the declarant is not notified before approving, then approves (S13)', async () => {
    await open();
    fireEvent.click(
      within(card('Stephen Mwangi Karanja')).getByRole('button', { name: 'Approve' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Approve referral to EACC' });
    expect(
      within(dialog).getByText('This sends the referral to EACC. The declarant is not notified.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('An RFL number is allocated in your name')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and send to EACC' }));
    expect(await screen.findByText(/^Approved\. RFL-TSC-\d{4}-\d{7}-[A-Z0-9] allocated\.$/));
    const approved = await loadReferral(client(), R.twoMissedCycles);
    expect(approved.ok && approved.data.status).toBe('approved');
    expect(screen.queryByRole('heading', { name: /Stephen Mwangi Karanja/ })).toBeNull();
  });

  it('requires a note to decline, and says nothing goes to EACC', async () => {
    await open();
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline referral' });
    expect(
      within(dialog).getByText('Nothing is sent to EACC. The note stays on the referral record.'),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline referral' }));
    expect(within(dialog).getByText('Enter a note.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'Declared in an amendment.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline referral' }));
    expect(await screen.findByText('Referral declined')).toBeTruthy();
    const declined = await loadReferral(client(), R.fromPeter);
    expect(declined.ok && declined.data).toMatchObject({
      status: 'declined',
      declineNote: 'Declared in an amendment.',
    });
  });

  it('explains a separation-of-duties refusal and offers Reassign (403)', async () => {
    await open();
    fireEvent.click(within(card('Mary Achieng')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve referral to EACC' });
    // The case is handed to the viewer while the inbox is open: they are now of record.
    await reassign(client(), CASES.peters, ME.subject);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and send to EACC' }));
    const notice = await screen.findByRole('dialog', { name: 'You cannot approve this' });
    expect(
      within(notice).getByText('You cannot approve this: you reviewed this case.'),
    ).toBeTruthy();
    expect(within(notice).getByText('403 separation-of-duties')).toBeTruthy();
    expect(within(notice).getByRole('button', { name: 'Reassign to another supervisor' }));
  });

  it('says so when someone else decided first (409 not-proposed)', async () => {
    await open();
    fireEvent.click(
      within(card('Stephen Mwangi Karanja')).getByRole('button', { name: 'Approve' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Approve referral to EACC' });
    const { declineReferral } = await import('../../server/referrals.server');
    await declineReferral(
      mockReviewClient('other', 'Joseph Mutua', [SUPERVISOR]),
      R.twoMissedCycles,
      'Elsewhere.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and send to EACC' }));
    const notice = await screen.findByRole('dialog', { name: 'Already decided' });
    expect(within(notice).getByText('409 not-proposed')).toBeTruthy();
  });
});
