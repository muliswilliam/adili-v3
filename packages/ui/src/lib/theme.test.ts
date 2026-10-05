import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyThemePreference,
  bootTheme,
  parseThemePreference,
  serverTheme,
  THEME_SCRIPT,
  themeRootProps,
} from './theme';

function mockDevice(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

/** Runs the head script in the page's global scope, as the browser runs an inline script. */
function runHeadScript() {
  window.eval(THEME_SCRIPT);
}

function clearCookie() {
  document.cookie = 'adili_theme=; Path=/; Max-Age=0';
}

describe('theme preference', () => {
  beforeEach(() => {
    clearCookie();
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCookie();
  });

  it('reads light and dark from the cookie, and anything else as system', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('purple')).toBe('system');
    expect(parseThemePreference(undefined)).toBe('system');
  });

  it('lets the server render only an explicit choice', () => {
    expect(serverTheme('dark')).toBe('dark');
    expect(serverTheme('system')).toBeUndefined();
  });

  it('gives <html> the explicit choice, and nothing for system', () => {
    expect(themeRootProps('dark')).toEqual({
      'data-theme': 'dark',
      style: { colorScheme: 'dark' },
    });
    expect(themeRootProps('system')).toEqual({});
  });

  it('stores the choice and applies it at once', () => {
    mockDevice(false);
    applyThemePreference('dark');
    expect(document.cookie).toContain('adili_theme=dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows the device for system', () => {
    mockDevice(true);
    applyThemePreference('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('boots from the cookie on a page without a server-rendered head', () => {
    mockDevice(true);
    document.cookie = 'adili_theme=light; Path=/';
    bootTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('runs the head script the same way', () => {
    mockDevice(true);
    runHeadScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
    document.cookie = 'adili_theme=light; Path=/';
    runHeadScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
