// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ImportRosterButton } from './import-roster-button';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

describe('ImportRosterButton', () => {
  it('opens the import wizard when no import runs', () => {
    render(<ImportRosterButton running={false} />);

    expect(screen.getByRole('link', { name: 'Import roster' }).getAttribute('href')).toBe(
      '/roster/import',
    );
  });

  it('is disabled while an import runs, and its tooltip says why', () => {
    render(<ImportRosterButton running />);
    const button = screen.getByRole('button', { name: 'Import roster' });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.queryByRole('link')).toBeNull();

    // The disabled button takes no focus; its focusable wrapper carries the tooltip.
    const wrapper = button.parentElement;
    if (!wrapper) throw new Error('no wrapper');
    fireEvent.focus(wrapper);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Wait for the current import to finish');
    expect(wrapper.getAttribute('aria-describedby')).toBe(tooltip.id);
  });
});
