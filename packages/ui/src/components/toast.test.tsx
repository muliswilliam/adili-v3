import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      Notify
    </button>
  );
}

function renderWithToast(options: ToastOptions) {
  render(
    <ToastProvider>
      <Trigger options={options} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders both live regions before any toast is shown', () => {
    render(<ToastProvider>content</ToastProvider>);

    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
  });

  it('announces polite toasts in the status region and dismisses them after a while', () => {
    renderWithToast({ title: 'Commission created' });

    expect(screen.getByRole('status').textContent).toContain('Commission created');
    expect(screen.getByRole('alert').textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText('Commission created')).toBeNull();
  });

  it('announces assertive toasts in the alert region and keeps them until dismissed', () => {
    renderWithToast({ title: 'Could not send the invite', urgency: 'assertive' });

    expect(screen.getByRole('alert').textContent).toContain('Could not send the invite');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Could not send the invite')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Could not send the invite')).toBeNull();
  });

  it('throws when used outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Trigger options={{ title: 'x' }} />)).toThrow(/ToastProvider/);
  });
});
