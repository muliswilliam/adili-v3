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
  });
});
