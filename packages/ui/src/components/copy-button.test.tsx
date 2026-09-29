import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyButton } from './copy-button';
import { ToastProvider } from './toast';

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function renderButton() {
  render(
    <ToastProvider>
      <CopyButton value="OFR-2026-00042" label="Copy officer reference" />
    </ToastProvider>,
  );
  return screen.getByRole('button', { name: 'Copy officer reference' });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CopyButton', () => {
  it('copies the value and announces success', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('OFR-2026-00042');
    expect(screen.getByRole('status').textContent).toContain('Copied');
  });

  it('announces a failure assertively when the clipboard is blocked', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')));
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain('Could not copy');
    expect(button.hasAttribute('data-copied')).toBe(false);
  });

  it('drops the tick when a copy fails soon after a successful one', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(button.hasAttribute('data-copied')).toBe(true);

    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(button.hasAttribute('data-copied')).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('Could not copy');
  });

  it('shows the tick for two seconds after copying', async () => {
    vi.useFakeTimers();
    mockClipboard(() => Promise.resolve());
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(button.hasAttribute('data-copied')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(button.hasAttribute('data-copied')).toBe(false);
  });

  it('restarts the tick and replaces the toast when copied again', async () => {
    vi.useFakeTimers();
    mockClipboard(() => Promise.resolve());
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(button.hasAttribute('data-copied')).toBe(true);
    expect(screen.getAllByText('Copied')).toHaveLength(1);
  });
});
