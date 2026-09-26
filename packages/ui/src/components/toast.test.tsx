import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { type ToastOptions, ToastProvider, useToast } from './toast';

function Trigger({ options }: { options: ToastOptions }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast(options);
      }}
    >
      Show
    </button>
  );
}

function renderWith(options: ToastOptions, duration?: number) {
  return render(
    <ToastProvider duration={duration}>
      <Trigger options={options} />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps both live regions mounted before any toast appears', () => {
    renderWith({ title: 'Saved' });

    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
  });

  it('announces a default toast politely', async () => {
    const user = userEvent.setup();
    renderWith({ title: 'Commission created', description: 'Mombasa CPSB' });

    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(screen.getByRole('status').textContent).toContain('Commission created');
    expect(screen.getByRole('status').textContent).toContain('Mombasa CPSB');
    expect(screen.getByRole('alert').textContent).toBe('');
  });

  it('announces a destructive toast assertively', async () => {
    const user = userEvent.setup();
    renderWith({ title: 'Issuer code already in use', variant: 'destructive' });

    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(screen.getByRole('alert').textContent).toContain('Issuer code already in use');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('lets the caller choose the live region', async () => {
    const user = userEvent.setup();
    renderWith({ title: 'Session expires in one minute', politeness: 'assertive' });

    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(screen.getByRole('alert').textContent).toContain('Session expires in one minute');
  });

  it('dismisses from its button', async () => {
    const user = userEvent.setup();
    renderWith({ title: 'Invitation resent', duration: null });

    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Invitation resent')).toBeNull();
  });

  it('dismisses itself after the duration', () => {
    vi.useFakeTimers();
    renderWith({ title: 'Invitation resent' }, 3000);

    act(() => {
      screen.getByRole('button', { name: 'Show' }).click();
    });
    expect(screen.getByText('Invitation resent')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('Invitation resent')).toBeNull();
  });

  it('dismisses without closing an open dialog', async () => {
    // jsdom has no stylesheet, so it cannot see the toast's `pointer-events: auto` over the
    // modal's `pointer-events: none` body.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ToastProvider>
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Assign reporting officer</DialogTitle>
            <DialogDescription>They get an activation email.</DialogDescription>
            <Trigger options={{ title: 'Email already invited', duration: null }} />
          </DialogContent>
        </Dialog>
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Email already invited')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('throws a clear error outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Trigger options={{ title: 'x' }} />)).toThrow(
      'useToast must be used inside a ToastProvider',
    );
    vi.mocked(console.error).mockRestore();
  });
});
