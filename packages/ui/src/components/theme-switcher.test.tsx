import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemePreferenceContext, ThemeSwitcher } from './theme-switcher';

describe('ThemeSwitcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'adili_theme=; Path=/; Max-Age=0';
  });

  it('names the current theme and offers System, Light and Dark', async () => {
    render(
      <ThemePreferenceContext value="light">
        <ThemeSwitcher />
      </ThemePreferenceContext>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Theme: Light' }));

    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual(['System', 'Light', 'Dark']);
    expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('applies and stores the picked theme', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }));
    render(<ThemeSwitcher initial="system" />);

    await userEvent.click(screen.getByRole('button', { name: 'Theme: System' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.cookie).toContain('adili_theme=dark');
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeTruthy();
  });
});
