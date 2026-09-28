// @vitest-environment jsdom
import { Dialog } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmExitsDialogContent, type ConfirmExitsDialogProps } from './confirm-exits-dialog';
import type { ExitingOfficer } from './exits';

const confirmRosterExits = vi.fn();
vi.mock('../../server/roster-exits', () => ({
  confirmRosterExits: (...args: unknown[]) => confirmRosterExits(...args) as unknown,
}));

const officers: ExitingOfficer[] = [
  {
    id: '0191f8d2-0000-7000-8000-000000000001',
    fullName: 'Achieng Otieno',
    personnelFileNumber: 'PSC/2019/0412',
  },
  {
    id: '0191f8d2-0000-7000-8000-000000000002',
    fullName: 'Brian Kiprono',
    personnelFileNumber: 'PSC/2020/0101',
  },
];

function renderDialog(overrides: Partial<ConfirmExitsDialogProps> = {}) {
  const props: ConfirmExitsDialogProps = {
    slug: 'psc',
    officers,
    onConfirmed: vi.fn(),
    onStale: vi.fn(),
    ...overrides,
  };
  render(
    <Dialog open>
      <ConfirmExitsDialogContent {...props} />
    </Dialog>,
  );
  return props;
}

const dialog = () => screen.getByRole('dialog');
const submit = (name: RegExp | string) => {
  fireEvent.click(within(dialog()).getByRole('button', { name }));
};

beforeEach(() => {
  // 28 Sep 2026, 10:00 in Nairobi.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T07:00:00Z'));
  confirmRosterExits.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConfirmExitsDialogContent', () => {
  it('opens with today as the exit date, not after today', () => {
    renderDialog();
    const date = within(dialog()).getByLabelText('Exit date');
    expect((date as HTMLInputElement).value).toBe('2026-09-28');
    expect(date.getAttribute('max')).toBe('2026-09-28');
    expect(within(dialog()).getByText(/no longer counted as expected declarants/)).toBeTruthy();
  });

  it('sends per-officer dates set under "Set per officer"', async () => {
    confirmRosterExits.mockResolvedValue({ ok: true, data: { batchId: 'b', count: 2 } });
    const props = renderDialog();
    fireEvent.change(within(dialog()).getByLabelText('Exit date for Brian Kiprono'), {
      target: { value: '2026-08-31' },
    });
    submit('Confirm 2 exits');
    await vi.waitFor(() => {
      expect(props.onConfirmed).toHaveBeenCalledWith({ batchId: 'b', count: 2 });
    });
    expect(confirmRosterExits).toHaveBeenCalledWith({
      data: {
        slug: 'psc',
        idempotencyKey: expect.any(String) as string,
        exits: {
          exitDate: '2026-09-28',
          records: [
            { recordId: officers[0]?.id },
            { recordId: officers[1]?.id, exitDate: '2026-08-31' },
          ],
        },
      },
    });
  });

  it('refuses a future date without calling the directory, and opens the officer list', () => {
    renderDialog();
    fireEvent.change(within(dialog()).getByLabelText('Exit date for Achieng Otieno'), {
      target: { value: '2026-10-02' },
    });
    submit('Confirm 2 exits');
    expect(within(dialog()).getByText('The exit date cannot be in the future.')).toBeTruthy();
    expect(dialog().querySelector('details')?.open).toBe(true);
    expect(confirmRosterExits).not.toHaveBeenCalled();
  });

  it('asks for an exit date when it was cleared', () => {
    renderDialog();
    fireEvent.change(within(dialog()).getByLabelText('Exit date'), { target: { value: '' } });
    submit('Confirm 2 exits');
    expect(within(dialog()).getByText('Enter an exit date.')).toBeTruthy();
    expect(within(dialog()).getByLabelText('Exit date').getAttribute('aria-invalid')).toBe('true');
  });

  it('stays open after a network failure and retries with the same key', async () => {
    confirmRosterExits
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce({ ok: true, data: { batchId: 'b', count: 2 } });
    const props = renderDialog();
    submit('Confirm 2 exits');
    await within(dialog()).findByText('Exits were not recorded. Try again.');
    submit('Confirm 2 exits');
    await vi.waitFor(() => {
      expect(props.onConfirmed).toHaveBeenCalled();
    });
    const keys = confirmRosterExits.mock.calls.map(
      (call) => (call[0] as { data: { idempotencyKey: string } }).data.idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it('hands over when officers changed since the page loaded', async () => {
    confirmRosterExits.mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'record-exited', title: 'Record already exited', status: 409 },
      },
    });
    const props = renderDialog();
    submit('Confirm 2 exits');
    await vi.waitFor(() => {
      expect(props.onStale).toHaveBeenCalled();
    });
  });

  it('names the officer when there is only one, without the per-officer list', () => {
    renderDialog({ officers: officers.slice(0, 1) });
    expect(screen.getByRole('dialog', { name: 'Confirm exit' })).toBeTruthy();
    expect(within(dialog()).getByText('PSC/2019/0412')).toBeTruthy();
    expect(within(dialog()).getByText('Last day worked. Not in the future.')).toBeTruthy();
    expect(dialog().querySelector('details')).toBeNull();
  });
});
