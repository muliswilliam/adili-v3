// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type Withdraw, WithdrawDialog } from './withdraw-dialog';
import { IDS, seededRequest } from './testing';

vi.mock('../sign-in', () => ({ signInAgain: vi.fn() }));

function open(withdraw: Withdraw) {
  const onWithdrawn = vi.fn();
  const onClose = vi.fn();
  render(
    <WithdrawDialog
      open
      reference="ARQ-PSC-2026-0000157-K"
      commission="Public Service Commission"
      withdraw={withdraw}
      onWithdrawn={onWithdrawn}
      onClose={onClose}
    />,
  );
  return { onWithdrawn, onClose };
}

const confirm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
};

describe('WithdrawDialog (S8)', () => {
  it('confirms, then withdraws once', async () => {
    const request = await seededRequest(IDS.notified);
    const withdraw = vi.fn<Withdraw>().mockResolvedValue({
      status: 'withdrawn',
      request: { ...request, status: 'withdrawn' },
    });
    const { onWithdrawn } = open(withdraw);
    expect(screen.getByText('Withdraw this request?')).toBeTruthy();
    expect(screen.getByText('ARQ-PSC-2026-0000157-K')).toBeTruthy();
    expect(screen.getByText(/Public Service Commission stops working on/)).toBeTruthy();
    confirm();
    await vi.waitFor(() => {
      expect(onWithdrawn).toHaveBeenCalledOnce();
    });
    expect(withdraw).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('says the request was decided first (409), and reloads it on close', async () => {
    const withdraw = vi.fn<Withdraw>().mockResolvedValue({ status: 'conflict', reason: 'decided' });
    const { onClose, onWithdrawn } = open(withdraw);
    confirm();
    expect(await screen.findByText('Already decided')).toBeTruthy();
    expect(
      screen.getByText(
        'Public Service Commission decided this request before you withdrew it, so it cannot be withdrawn.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See the request' }));
    expect(onClose).toHaveBeenCalledWith(true);
    expect(onWithdrawn).not.toHaveBeenCalled();
  });

  it('says a closed request has nothing to withdraw', async () => {
    open(vi.fn<Withdraw>().mockResolvedValue({ status: 'conflict', reason: 'closed' }));
    confirm();
    expect(await screen.findByText('Already closed')).toBeTruthy();
  });

  it('keeps the dialog open when the service is down, and retries with the same key', async () => {
    const withdraw = vi.fn<Withdraw>().mockResolvedValue({ status: 'unavailable' });
    open(withdraw);
    confirm();
    expect(
      await screen.findByText('We could not withdraw the request. Try again in a few minutes.'),
    ).toBeTruthy();
    confirm();
    await vi.waitFor(() => {
      expect(withdraw).toHaveBeenCalledTimes(2);
    });
    expect(withdraw.mock.calls[1]?.[0]).toBe(withdraw.mock.calls[0]?.[0]);
  });

  it('cancels without withdrawing', () => {
    const withdraw = vi.fn<Withdraw>();
    const { onClose } = open(withdraw);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(withdraw).not.toHaveBeenCalled();
  });
});
