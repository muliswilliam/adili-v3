// @vitest-environment jsdom
import { EACC_ANALYST } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listReferralIntake } from '../../server/referral-intake.server';
import { mockReportingClient } from '../../server/reporting/mock.server';
import { resetReferralIntakeMock } from '../../server/reporting/referral-intake-mock.server';
import type { ReferralIntakePage } from '../../server/reporting/types';
import type { ServiceResult } from '../../server/service-call';
import { type IntakeFilter, ReferralIntakeView } from './referral-intake-view';

const NOW_MS = Date.parse('2026-10-03T09:00:00Z');

const harness = { reload: () => Promise.resolve() };
const invalidate = vi.fn(() => harness.reload());
const download = vi.fn();
const pushes = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
}));

vi.mock('../download', () => ({
  downloadFrom: (url: string) => {
    download(url);
  },
}));

const client = () => mockReportingClient('Brian Otieno', [EACC_ANALYST]);

vi.mock('../../server/referral-intake', async () => {
  const server = await import('../../server/referral-intake.server');
  return {
    pushReferralToIcms: vi.fn(
      ({ data }: { data: { referralId: string; idempotencyKey: string } }) => {
        pushes(data);
        return server.pushToIcms(client(), data.referralId, data.idempotencyKey);
      },
    ),
    getIntakePackageLink: vi.fn(({ data }: { data: { packageDocumentId: string } }) =>
      Promise.resolve({
        ok: true,
        data: { downloadUrl: `/api/mock-files/${data.packageDocumentId}` },
      }),
    ),
  };
});

function Harness({
  filter,
  onFilterChange,
}: {
  filter: IntakeFilter;
  onFilterChange?: (filter: IntakeFilter) => void;
}) {
  const [result, setResult] = useState<ServiceResult<ReferralIntakePage> | null>(null);
  useEffect(() => {
    const load = async () => {
      const next = await listReferralIntake(client(), {
        ...(filter === 'all' ? {} : { icmsStatus: filter }),
      });
      act(() => {
        setResult(next);
      });
    };
    harness.reload = load;
    void load();
  }, [filter]);
  return (
    <ReferralIntakeView
      result={result}
      filter={filter}
      firstPage
      onFilterChange={onFilterChange ?? (() => undefined)}
    />
  );
}

function wrap(children: React.ReactNode) {
  return render(
    <ToastProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </ToastProvider>,
  );
}

async function open(filter: IntakeFilter = 'all') {
  wrap(<Harness filter={filter} />);
  await screen.findByRole('table', { name: 'Referrals received from Commissions' });
}

function row(reference: string) {
  const cell = screen.getByText(reference);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no row for ${reference}`);
  return within(tr);
}

beforeEach(() => {
  resetReferralIntakeMock(NOW_MS);
  invalidate.mockClear();
  download.mockClear();
  pushes.mockClear();
});

describe('ReferralIntakeView (spec 09 FE-5, S12, S15)', () => {
  it('lists each referral with its Commission, grounds, package and ICMS status', async () => {
    await open();
    const notPushed = row('RFL-PSC-2026-0000003-7');
    expect(notPushed.getByText('Public Service Commission')).toBeTruthy();
    expect(notPushed.getByText('Two missed biennial cycles')).toBeTruthy();
    expect(notPushed.getByText('Not pushed')).toBeTruthy();
    expect(notPushed.getByText('Confidential')).toBeTruthy();
    expect(notPushed.getByRole('button', { name: 'Push to ICMS' })).toBeTruthy();

    const failed = row('RFL-NPSC-2026-0000012-4');
    expect(failed.getByText('Failed')).toBeTruthy();
    expect(failed.getByText('ICMS did not respond. Nothing was registered.')).toBeTruthy();
    expect(failed.getByRole('button', { name: 'Retry' })).toBeTruthy();

    const pushed = row('RFL-CPSB047-2026-0000005-R');
    expect(pushed.getByText('Pushed')).toBeTruthy();
    expect(pushed.getByText('Waiting for case number')).toBeTruthy();
    expect(pushed.queryByRole('button', { name: /Push to ICMS|Retry/ })).toBeNull();

    const registered = row('RFL-PSC-2026-0000031-B');
    expect(registered.getByText('Registered')).toBeTruthy();
    expect(registered.getByText('ICMS-2026-004790')).toBeTruthy();
  });

  it('shows the loading state while the page loads', () => {
    wrap(
      <ReferralIntakeView result={null} filter="all" firstPage onFilterChange={() => undefined} />,
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('says nothing has been received yet on an empty intake', () => {
    wrap(
      <ReferralIntakeView
        result={{ ok: true, data: { items: [], nextCursor: null } }}
        filter="all"
        firstPage
        onFilterChange={() => undefined}
      />,
    );
    expect(screen.getByText('No referrals received yet')).toBeTruthy();
    expect(screen.getByText('Approved Commission referrals appear here.')).toBeTruthy();
  });

  it('offers Show all when no referral has the chosen status', () => {
    const change = vi.fn();
    wrap(
      <ReferralIntakeView
        result={{ ok: true, data: { items: [], nextCursor: null } }}
        filter="pushed"
        firstPage
        onFilterChange={change}
      />,
    );
    expect(screen.getByText('No referrals with this status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(change).toHaveBeenCalledWith('all');
  });

  it('shows a load failure with a retry', () => {
    wrap(
      <ReferralIntakeView
        result={{ ok: false, error: { kind: 'unavailable', detail: null } }}
        filter="all"
        firstPage
        onFilterChange={() => undefined}
      />,
    );
    expect(screen.getByText('Could not load referrals')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('filters by ICMS status', async () => {
    const change = vi.fn<(filter: IntakeFilter) => void>();
    wrap(<Harness filter="all" onFilterChange={change} />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(change).toHaveBeenCalledWith('push-failed');
  });

  it('pushes to ICMS after the confirm, then shows the case number', async () => {
    await open();
    fireEvent.click(row('RFL-PSC-2026-0000003-7').getByRole('button', { name: 'Push to ICMS' }));
    const dialog = await screen.findByRole('dialog', { name: 'Push to ICMS' });
    expect(
      within(dialog).getByText('Send this referral to ICMS? The case number will be recorded.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('What ICMS receives')).toBeTruthy();
    expect(within(dialog).getByText('ID number and full name')).toBeTruthy();
    expect(within(dialog).getByText('RFL-PSC-2026-0000003-7')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Push to ICMS' }));
    expect(await screen.findByText(/^Registered in ICMS as ICMS-2026-\d{6}$/)).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    const pushed = row('RFL-PSC-2026-0000003-7');
    expect(pushed.getByText('Registered')).toBeTruthy();
    expect(pushed.getByText(/^ICMS-2026-\d{6}$/)).toBeTruthy();
  });

  it('marks the referral failed when ICMS is down, and the retry registers it', async () => {
    await open();
    fireEvent.click(row('RFL-TSC-2026-0000041-K').getByRole('button', { name: 'Push to ICMS' }));
    const dialog = await screen.findByRole('dialog', { name: 'Push to ICMS' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Push to ICMS' }));
    expect(await screen.findByText('ICMS did not register the referral. Try again.')).toBeTruthy();
    await vi.waitFor(() => {
      expect(row('RFL-TSC-2026-0000041-K').getByText('Failed')).toBeTruthy();
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(row('RFL-TSC-2026-0000041-K').getByRole('button', { name: 'Retry' }));
    const retry = await screen.findByRole('dialog', { name: 'Retry push to ICMS' });
    fireEvent.click(within(retry).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(row('RFL-TSC-2026-0000041-K').getByText('Registered')).toBeTruthy();
    });
    // One key per confirmation: the retry is a new request.
    expect(pushes).toHaveBeenCalledTimes(2);
    const [first, second] = pushes.mock.calls.map(([data]) => data as { idempotencyKey: string });
    expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
  });

  it('downloads the Confidential package from the row', async () => {
    await open();
    fireEvent.click(
      row('RFL-PSC-2026-0000003-7').getByRole('button', {
        name: 'Download the evidence package of RFL-PSC-2026-0000003-7',
      }),
    );
    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/mock-files\/eacc0000-/));
    });
  });

  it('opens a registered referral with its case number, what the Commission sees and its history', async () => {
    await open();
    fireEvent.click(
      row('RFL-PSC-2026-0000031-B').getByRole('button', { name: 'View RFL-PSC-2026-0000031-B' }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'RFL-PSC-2026-0000031-B' });
    expect(within(drawer).getByText('Undeclared assets')).toBeTruthy();
    expect(within(drawer).getByText('Regs r.20(1)(c)')).toBeTruthy();
    expect(within(drawer).getByText('ICMS-2026-004790')).toBeTruthy();
    expect(
      within(drawer).getByText('The Commission sees "ICMS case ICMS-2026-004790" on its referral.'),
    ).toBeTruthy();
    expect(within(drawer).getByText('Registered in ICMS as ICMS-2026-004790')).toBeTruthy();
    expect(within(drawer).getByText('Pushed to ICMS by Brian Otieno')).toBeTruthy();
    expect(within(drawer).getByText('Received from the Commission')).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: /Push to ICMS|Retry/ })).toBeNull();
  });

  it('pushes from the drawer of a failed referral', async () => {
    await open();
    fireEvent.click(
      row('RFL-NPSC-2026-0000012-4').getByRole('button', { name: 'RFL-NPSC-2026-0000012-4' }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'RFL-NPSC-2026-0000012-4' });
    expect(within(drawer).getByText('ICMS did not register this referral.')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Retry' }));
    const retry = await screen.findByRole('dialog', { name: 'Retry push to ICMS' });
    fireEvent.click(within(retry).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/^Registered in ICMS as ICMS-2026-\d{6}$/)).toBeTruthy();
  });
});
