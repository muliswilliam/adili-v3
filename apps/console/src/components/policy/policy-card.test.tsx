// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  DirectoryResult,
  TenantPolicyHistory,
  TenantPolicyVersion,
} from '../../server/directory/client';
import { PolicyCard } from './policy-card';
import type { SavePolicyVersion } from './policy-dialog';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

function version(v: number, overrides: Partial<TenantPolicyVersion> = {}): TenantPolicyVersion {
  return {
    id: `0199a0b4-0000-7000-8000-00000000000${v}`,
    version: v,
    effectiveFrom: '2026-08-03T06:14:00Z',
    obligationsStartDate: '2026-08-03',
    initialDueAfterAppointmentDays: 30,
    biennial: { statementDate: '11-01', dueDate: '12-31' },
    finalDueAfterExitDays: 30,
    reminderOffsetsDays: [30, 14, 7],
    clarification: { issueWindowMonths: 6, replyWindowDays: 30 },
    formMDue: '07-31',
    createdBy: '0199a0b4-0000-7000-8000-0000000000aa',
    createdByName: 'Amina Wanjiru',
    createdAt: '2026-08-03T06:14:00Z',
    ...overrides,
  };
}

const v1 = version(1);
const v2 = version(2, {
  effectiveFrom: '2026-09-26T07:30:00Z',
  obligationsStartDate: '2026-07-01',
  createdByName: 'Daniel Kiprop',
});

function renderCard(history: TenantPolicyHistory, save?: SavePolicyVersion) {
  return render(
    <ToastProvider>
      <PolicyCard history={history} save={save} onUnauthenticated={vi.fn()} />
    </ToastProvider>,
  );
}

const unavailable: DirectoryResult<never> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

const dateInput = () => screen.getByLabelText<HTMLInputElement>('Obligations start date');

describe('S19 policy card', () => {
  it('shows the periods, reminders and start date in force, with the history newest first', () => {
    renderCard({ current: v2, previous: [v1] });
    const card = screen.getByRole('region', { name: 'Policy' });
    expect(card.textContent).toContain('Version 2 in force since 26 Sep 2026');
    expect(card.textContent).toContain('Initial: 30 days after appointment');
    expect(card.textContent).toContain('Biennial: statement 1 Nov, due 31 Dec');
    expect(card.textContent).toContain('Final: 30 days after leaving office');
    expect(card.textContent).toContain('30, 14 and 7 days before due');
    expect(card.textContent).toContain('1 Jul 2026');
    const items = within(card).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'v2Effective 26 Sep 2026, 10:30In forceObligations start date 1 Jul 2026 · by Daniel Kiprop',
      'v1Effective 3 Aug 2026, 09:14Platform defaults · by Amina Wanjiru',
    ]);
  });

  it('leaves out who created a version when the directory does not know their name', () => {
    renderCard({ current: version(1, { createdByName: null }), previous: [] });
    const card = screen.getByRole('region', { name: 'Policy' });
    expect(within(card).getByRole('listitem').textContent).toBe(
      'v1Effective 3 Aug 2026, 09:14In forcePlatform defaults',
    );
  });

  it('has no Change action when read only (reviewer, supervisor)', () => {
    renderCard({ current: v1, previous: [] });
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});

describe('S19 change dialog', () => {
  it('opens on the start date in force and refuses it unchanged, without a request', async () => {
    const save = vi.fn<SavePolicyVersion>();
    renderCard({ current: v1, previous: [] }, save);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change obligations start date' });
    expect(dialog.textContent).toContain('Current start date: 3 Aug 2026 (version 1)');
    expect(dialog.textContent).toContain('Saves as version 2, effective now.');
    expect(dateInput().value).toBe('2026-08-03');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as new policy version' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(dialog.textContent).toContain(
      'This is already the start date in force. Choose a different date.',
    );
    expect(dateInput().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(dateInput());
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('saves a new version, names it in a toast and reloads the page', async () => {
    let resolve: (result: DirectoryResult<TenantPolicyVersion>) => void = () => undefined;
    const save = vi.fn<SavePolicyVersion>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderCard({ current: v1, previous: [] }, save);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dateInput(), { target: { value: '2026-07-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as new policy version' }));

    // Saving: the button says so and nothing can be changed.
    const saving = await within(dialog).findByRole('button', { name: 'Saving…' });
    expect(saving.hasAttribute('disabled')).toBe(true);
    expect(dateInput().matches(':disabled')).toBe(true);
    expect(save.mock.calls[0]?.[0].obligationsStartDate).toBe('2026-07-01');
    expect(save.mock.calls[0]?.[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    resolve({ ok: true, data: v2 });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect((await screen.findByText('Policy version 2 in force')).textContent).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
  });

  it('says the policy was not changed after a failure, and retries with the same key', async () => {
    const save = vi.fn<SavePolicyVersion>().mockResolvedValue(unavailable);
    renderCard({ current: v1, previous: [] }, save);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dateInput(), { target: { value: '2026-07-01' } });
    const submit = within(dialog).getByRole('button', { name: 'Save as new policy version' });
    fireEvent.click(submit);

    await within(dialog).findByText('The policy was not changed. Try again.');
    expect(dialog.textContent).toContain('Version 1 is still in force.');
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as new policy version' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(save.mock.calls[1]?.[0].idempotencyKey).toBe(save.mock.calls[0]?.[0].idempotencyKey);
  });

  it('shows a refusal from the directory and uses a new key for the corrected request', async () => {
    const save = vi.fn<SavePolicyVersion>().mockResolvedValue({
      ok: false,
      error: { kind: 'problem', problem: { type: 'about:blank', title: 'No', status: 403 } },
    });
    renderCard({ current: v1, previous: [] }, save);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dateInput(), { target: { value: '2026-07-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as new policy version' }));
    await within(dialog).findByText('You cannot change this policy.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as new policy version' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(save.mock.calls[1]?.[0].idempotencyKey).not.toBe(save.mock.calls[0]?.[0].idempotencyKey);
  });

  it('discards the draft on Cancel', async () => {
    renderCard({ current: v1, previous: [] }, vi.fn<SavePolicyVersion>());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await screen.findByRole('dialog');
    fireEvent.change(dateInput(), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await screen.findByRole('dialog');
    expect(dateInput().value).toBe('2026-08-03');
  });
});

describe('S16 AI status line', () => {
  const renderWithStatus = (aiStatus: Parameters<typeof PolicyCard>[0]['aiStatus']) =>
    render(
      <ToastProvider>
        <PolicyCard
          history={{ current: v1, previous: [] }}
          aiStatus={aiStatus}
          onUnauthenticated={vi.fn()}
        />
      </ToastProvider>,
    );
  const aiRow = () => {
    const term = screen.getByText('AI assistance');
    return term.parentElement?.textContent;
  };

  it('says AI assistance is enabled and how, as the spec words it, read only', () => {
    renderWithStatus({
      ok: true,
      data: {
        enabled: true,
        providerClass: 'external',
        provider: 'anthropic',
        dataClasses: ['synthetic'],
      },
    });
    // The badge says Enabled; the detail reads on from it, no brackets (e2e 33).
    expect(aiRow()).toBe('AI assistanceEnabledExternal provider Anthropic, synthetic data only');
    expect(screen.queryByRole('button', { name: /edit|change/i })).toBeNull();
  });

  it('says it is not enabled and that no declaration data leaves', () => {
    renderWithStatus({
      ok: true,
      data: { enabled: false, providerClass: null, provider: null, dataClasses: [] },
    });
    expect(aiRow()).toBe('AI assistanceNot enabledNo declaration data is sent to an AI provider');
  });

  it('says when the status could not be checked', () => {
    renderWithStatus({ ok: false, error: { kind: 'unavailable', detail: null } });
    expect(aiRow()).toBe('AI assistanceCould not be checked. Reload the page to try again.');
  });

  it('has no AI row without a status (platform admins on a Commission page)', () => {
    renderWithStatus(undefined);
    expect(screen.queryByText('AI assistance')).toBeNull();
  });
});
