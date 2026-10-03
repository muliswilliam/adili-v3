// @vitest-environment jsdom
import { SUPERVISOR } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadReferral } from '../../server/referrals.server';
import { reassign } from '../../server/review-case.server';
import {
  MOCK_CASE_IDS as CASES,
  mockReviewClient,
  resetReviewMock,
} from '../../server/review/mock.server';
import {
  MOCK_PACKAGE_DELAY_MS,
  MOCK_REFERRAL_IDS as R,
} from '../../server/review/referrals-mock.server';
import type { Assignee, Referral } from '../../server/review/types';
import { ReferralPage } from './referral-page';

const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
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

const signedIn = { officer: ME, roles: [SUPERVISOR] as string[] };
const client = () =>
  mockReviewClient(signedIn.officer.subject, signedIn.officer.name, signedIn.roles);

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
    getReferralPackageLink: vi.fn(() =>
      Promise.resolve({ ok: true, data: { downloadUrl: '/api/mock-files/package' } }),
    ),
  };
});
vi.mock('../../server/approvals', () => ({
  getSupervisors: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  reassignToSupervisor: vi.fn(),
}));

async function referralOf(id: string): Promise<Referral> {
  const result = await loadReferral(client(), id);
  if (!result.ok) throw new Error('referral');
  return result.data;
}

function Harness({ initial, supervisor }: { initial: Referral; supervisor: boolean }) {
  const [referral, setReferral] = useState(initial);
  useEffect(() => {
    harness.reload = async () => {
      const next = await referralOf(initial.id);
      act(() => {
        setReferral(next);
      });
    };
  }, [initial.id]);
  return (
    <ReferralPage
      referral={referral}
      viewer={signedIn.officer}
      supervisor={supervisor}
      slug="tsc"
    />
  );
}

async function open(id: string, { supervisor = true } = {}) {
  signedIn.roles = supervisor ? [SUPERVISOR] : ['reviewer'];
  render(
    <ToastProvider>
      <TooltipProvider>
        <Harness initial={await referralOf(id)} supervisor={supervisor} />
      </TooltipProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
  invalidate.mockClear();
  download.mockClear();
  signedIn.officer = ME;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReferralPage (spec 08 FE-6)', () => {
  it('shows a system proposal with what its package will include (S12)', async () => {
    await open(R.twoMissedCycles);
    expect(screen.getByRole('heading', { level: 1, name: 'Proposed referral' })).toBeTruthy();
    expect(screen.getAllByText('Awaiting approval').length).toBeGreaterThan(0);
    expect(screen.getByText('Two missed cycles')).toBeTruthy();
    expect(screen.getByText('Confidential')).toBeTruthy();
    expect(screen.getByText('The declarant is not told. EACC decides what they learn.'));
    expect(screen.getByText(/^System sweep · /)).toBeTruthy();
    expect(screen.getByText('Assembled on approval, with a SHA-256 hash per item.')).toBeTruthy();
    const preview = screen.getByRole('table', { name: 'Evidence package' });
    expect(within(preview).getAllByText('Obligation history')).toHaveLength(2);
    expect(within(preview).getAllByText(/^Biennial declaration \d{4}$/)).toHaveLength(2);
    expect(within(preview).getByText('RFL on approval')).toBeTruthy();
    expect(within(preview).queryByText('SHA-256')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeTruthy();
  });

  it('approves, then shows the package assembling until it is sent (S13)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS });
    await open(R.fromPeter);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve referral to EACC' });
    expect(within(dialog).getByText(/^\d+ items with SHA-256 hashes on the cover sheet/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and send to EACC' }));
    expect(await screen.findByText(/^Approved\. RFL-TSC-\d{4}-\d{7}-[A-Z0-9] allocated\.$/));
    expect(screen.getByRole('heading', { level: 1, name: /^RFL-TSC-/ })).toBeTruthy();
    expect(
      screen.getByText('Approved by Faith Achieng. Assembling the package and sending.'),
    ).toBeTruthy();
    expect(screen.getByText('Assembling now. Hashes appear when it is sent.')).toBeTruthy();

    vi.setSystemTime(NOW_MS + MOCK_PACKAGE_DELAY_MS);
    await act(() => harness.reload());
    expect(screen.getAllByText('Sent to EACC').length).toBeGreaterThan(0);
    const manifest = screen.getByRole('table', { name: 'Evidence package' });
    expect(within(manifest).getByText('SHA-256')).toBeTruthy();
    expect(within(manifest).getAllByText(/^[0-9a-f]{64}$/).length).toBeGreaterThan(0);
  });

  it('shows a sent referral’s manifest and downloads the package', async () => {
    await open(R.sent);
    expect(screen.getByText(/^VRF-/)).toBeTruthy();
    expect(screen.getByText('Approved by')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download package' }));
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledWith('/api/mock-files/package');
    });
  });

  it('shows who declined and their note; no package was assembled', async () => {
    await open(R.declined);
    expect(screen.getByRole('heading', { level: 1, name: 'Declined referral' })).toBeTruthy();
    expect(screen.getByText('Declined by')).toBeTruthy();
    expect(screen.getByText(/The declarant died on 3 Jun/)).toBeTruthy();
    expect(screen.getByText('No package was assembled.')).toBeTruthy();
  });

  it('tells a reviewer only a supervisor approves', async () => {
    await open(R.fromPeter, { supervisor: false });
    expect(screen.getByText('Only a supervisor can approve a referral to EACC.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reassign' })).toBeNull();
  });

  it('tells the proposer another supervisor must approve, with Reassign', async () => {
    await open(R.byCaller);
    expect(screen.getByText('You proposed this. Another supervisor must approve it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeTruthy();
  });

  it('says why after a separation-of-duties refusal (403), and offers Reassign', async () => {
    await open(R.fromPeter);
    await reassign(client(), CASES.peters, ME.subject);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve referral to EACC' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and send to EACC' }));
    expect(
      await screen.findByText('You cannot approve this: you reviewed this case.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeTruthy();
  });

  it('links to the case a referral was proposed from', async () => {
    await open(R.fromPeter);
    expect(screen.getByRole('link', { name: 'Open case' }).getAttribute('href')).toBe(
      `/review/cases/${CASES.peters}`,
    );
  });
});
