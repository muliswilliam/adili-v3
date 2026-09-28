// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordActions } from './record-actions';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const keepRosterRecords = vi.fn();
vi.mock('../../server/roster-exits', () => ({
  confirmRosterExits: vi.fn(),
  keepRosterRecords: (...args: unknown[]) => keepRosterRecords(...args) as unknown,
}));

const goToSignIn = vi.fn();
vi.mock('../sign-in-redirect', () => ({
  goToSignIn: (...args: unknown[]) => goToSignIn(...args) as unknown,
}));

const base = {
  id: '0191f8d2-0000-7000-8000-000000000001',
  fullName: 'Achieng Otieno',
  personnelFileNumber: 'PSC/2019/0412',
  state: 'not_onboarded',
  absentFromLatestImport: false,
} as const;

function renderActions(record: Partial<Parameters<typeof RecordActions>[0]['record']> = {}) {
  render(
    <ToastProvider>
      <RecordActions slug="psc" record={{ ...base, ...record }} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  invalidate.mockReset();
  keepRosterRecords.mockReset();
  goToSignIn.mockReset();
});

describe('RecordActions', () => {
  it('offers only "Confirm exit" for a record that is not flagged', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'Confirm exit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark as still employed' })).toBeNull();
  });

  it('marks a flagged record as still employed and reloads it', async () => {
    keepRosterRecords.mockResolvedValue({ ok: true, data: { count: 1 } });
    renderActions({ absentFromLatestImport: true });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as still employed' }));
    await screen.findByText('1 officer marked as still employed');
    expect(keepRosterRecords).toHaveBeenCalledWith({
      data: { slug: 'psc', idempotencyKey: expect.any(String) as string, recordIds: [base.id] },
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it('sends a signed-out officer to sign in, back to this page with its query', async () => {
    keepRosterRecords.mockResolvedValue({ ok: false, error: { kind: 'unauthenticated' } });
    renderActions({ absentFromLatestImport: true });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as still employed' }));
    await vi.waitFor(() => {
      expect(goToSignIn).toHaveBeenCalledWith();
    });
  });

  it('opens the confirm exit dialog for this officer', () => {
    renderActions({ absentFromLatestImport: true });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exit' }));
    expect(screen.getByRole('dialog', { name: 'Confirm exit' })).toBeTruthy();
  });

  it('offers nothing once the officer has exited', () => {
    renderActions({ state: 'exited', absentFromLatestImport: true });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
