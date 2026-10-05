import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'adili_theme=; Path=/; Max-Age=0';
  });

  it('steps System, Light, Dark and stores each choice', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }));
    render(<ThemeToggle initial="system" />);

    await userEvent.click(screen.getByRole('button', { name: 'Theme: System. Switch to Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.cookie).toContain('adili_theme=light');

    await userEvent.click(screen.getByRole('button', { name: 'Theme: Light. Switch to Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Theme: Dark. Switch to System' })).toBeTruthy();
  });
});
