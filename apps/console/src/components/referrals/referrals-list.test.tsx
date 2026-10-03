// @vitest-environment jsdom
import { TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listReferrals } from '../../server/referrals.server';
import { mockReviewClient, resetReviewMock } from '../../server/review/mock.server';
import { type ReferralFilter, ReferralsList, type ReferralsListProps } from './referrals-list';

const NOW_MS = Date.parse('2026-10-02T09:00:00Z');
const client = () => mockReviewClient('me', 'Faith Achieng');

function show(props: Partial<ReferralsListProps> & Pick<ReferralsListProps, 'result'>) {
  const onFilterChange = vi.fn<(filter: ReferralFilter) => void>();
  render(
    <TooltipProvider>
      <ReferralsList
        filter="all"
        firstPage
        onFilterChange={onFilterChange}
        referralLink={(referral, label) => <a href={`/referrals/${referral.id}`}>{label}</a>}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onFilterChange };
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

describe('ReferralsList (spec 08 FE-6)', () => {
  it('lists each referral with its reference, grounds, declarant, proposer and status', async () => {
    show({ result: await listReferrals(client(), 'tsc', {}) });
    const table = screen.getByRole('table', { name: 'Referrals to EACC' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(7);
    const sent = rows.find((row) => within(row).queryByText(/^RFL-TSC-/));
    expect(sent && within(sent).getByText('Sent to EACC')).toBeTruthy();
    const system = rows.find((row) => within(row).queryByText('Stephen Mwangi Karanja'));
    expect(system && within(system).getByText('System')).toBeTruthy();
    expect(system && within(system).getByText('Not yet')).toBeTruthy();
    expect(system && within(system).getByText('Awaiting approval')).toBeTruthy();
    expect(screen.getByText('Confidential')).toBeTruthy();
  });

  it('filters by status', async () => {
    const { onFilterChange } = show({ result: await listReferrals(client(), 'tsc', {}) });
    fireEvent.click(screen.getByRole('button', { name: 'Declined' }));
    expect(onFilterChange).toHaveBeenCalledWith('declined');
  });

  it('says when there are none, or none of a status', () => {
    const empty = { ok: true as const, data: { items: [], nextCursor: null } };
    show({ result: empty });
    expect(screen.getByText('No referrals yet')).toBeTruthy();
    document.body.innerHTML = '';
    const { onFilterChange } = show({ result: empty, filter: 'approved' });
    expect(screen.getByText('No matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(onFilterChange).toHaveBeenCalledWith('all');
  });

  it('says when the referrals could not be loaded', () => {
    show({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(screen.getByText('Could not load referrals')).toBeTruthy();
  });
});
