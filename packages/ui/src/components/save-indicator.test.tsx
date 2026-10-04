import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SaveIndicator, type SaveStatus } from './save-indicator';

describe('SaveIndicator', () => {
  it.each<[SaveStatus, string]>([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['retrying', 'Could not save, retrying'],
    ['conflict', 'Edited elsewhere: reload to continue'],
  ])('says %s in text through a live region', (status, text) => {
    render(<SaveIndicator status={status} />);

    expect(screen.getByRole('status').textContent).toBe(text);
  });

  it('announces saving politely and a conflict at once', () => {
    const { rerender } = render(<SaveIndicator status="saving" />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');

    rerender(<SaveIndicator status="conflict" />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('assertive');
  });

  it('offers a reload button only on conflict, outside the live region', () => {
    const onReload = vi.fn();
    const { rerender } = render(<SaveIndicator status="retrying" onReload={onReload} />);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<SaveIndicator status="conflict" onReload={onReload} />);
    const button = screen.getByRole('button', { name: 'Reload' });
    expect(screen.getByRole('status').contains(button)).toBe(false);

    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('shows a conflict as a problem, apart from retrying', () => {
    const { rerender } = render(<SaveIndicator status="retrying" />);
    expect(screen.getByRole('status').className).not.toContain('text-destructive');

    rerender(<SaveIndicator status="conflict" />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('text-destructive');
    expect(status.querySelector('svg')).toBeTruthy();
  });

  it('takes custom messages', () => {
    render(<SaveIndicator status="saved" messages={{ saved: 'Saved at 10:42' }} />);

    expect(screen.getByRole('status').textContent).toBe('Saved at 10:42');
  });

  it('says it autosaves before anything is edited, without an icon', () => {
    render(<SaveIndicator status="idle" />);

    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Autosaves');
    expect(status.querySelector('svg')).toBeNull();
  });

  it('says a refused save at once, in red', () => {
    render(<SaveIndicator status="error" messages={{ error: 'Approved: no longer editable' }} />);

    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Approved: no longer editable');
    expect(status.getAttribute('aria-live')).toBe('assertive');
    expect(status.className).toContain('text-destructive');
  });
});
