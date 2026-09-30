import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog';
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

/** The toast card, found from its title. */
function toastElement(title: string): HTMLElement {
  const toast = screen.getByText(title).closest<HTMLElement>('[data-urgency]');
  if (!toast) throw new Error(`no toast titled ${title}`);
  return toast;
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

  it('pauses the auto-dismiss while hovered', () => {
    renderWithToast({ title: 'Commission created' });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const toast = toastElement('Commission created');
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Commission created')).toBeDefined();

    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByText('Commission created')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Commission created')).toBeNull();
  });

  it('pauses the auto-dismiss while it has focus', () => {
    renderWithToast({ title: 'Commission created' });

    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => {
      dismiss.focus();
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Commission created')).toBeDefined();

    act(() => {
      dismiss.blur();
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText('Commission created')).toBeNull();
  });

  it('treats a non-finite duration as sticky rather than dismissing at once', () => {
    renderWithToast({ title: 'Commission created', duration: Number.POSITIVE_INFINITY });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Commission created')).toBeDefined();
  });

  it('caps a duration longer than a timer can hold instead of dismissing at once', () => {
    const maxDelay = 2 ** 31 - 1;
    renderWithToast({ title: 'Commission created', duration: 2 ** 31 + 5000 });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Commission created')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(maxDelay - 60_000);
    });
    expect(screen.queryByText('Commission created')).toBeNull();
  });

  it('styles assertive toasts as destructive', () => {
    renderWithToast({ title: 'Email already in use', urgency: 'assertive' });

    expect(toastElement('Email already in use').className).toContain('bg-destructive');
  });

  it('does not dim the description of an assertive toast, which would miss 4.5:1', () => {
    renderWithToast({
      title: 'Could not send the invite',
      description: 'Check the address and try again.',
      urgency: 'assertive',
    });

    const description = screen.getByText('Check the address and try again.');
    expect(description.className).not.toMatch(/opacity/);
  });

  it('does not style polite toasts as destructive', () => {
    renderWithToast({ title: 'Commission created' });

    expect(toastElement('Commission created').className).not.toContain('bg-destructive');
  });

  it('throws when used outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Trigger options={{ title: 'x' }} />)).toThrow(/ToastProvider/);
  });
});

function DialogWithToast() {
  return (
    <ToastProvider>
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Replace reporting officer</DialogTitle>
          <Trigger options={{ title: 'Email already in use', urgency: 'assertive' }} />
        </DialogContent>
      </Dialog>
    </ToastProvider>
  );
}

describe('Toast with a modal dialog open', () => {
  it('announces toasts from outside the aria-hidden page', () => {
    const { container } = render(<DialogWithToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));

    const region = screen.getByRole('alert');
    expect(region.textContent).toContain('Email already in use');
    expect(region.closest('[aria-hidden="true"]')).toBeNull();
    // Portalled to the body rather than nested in the app tree the dialog hides.
    expect(container.contains(region)).toBe(false);
  });

  it('lets the toast be dismissed without closing the dialog', async () => {
    render(<DialogWithToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    // Radix starts listening for outside pointer events a tick after the dialog opens.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.pointerDown(dismiss);
    fireEvent.click(dismiss);

    expect(screen.queryByText('Email already in use')).toBeNull();
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});
