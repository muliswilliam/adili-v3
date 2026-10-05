/**
 * The colour theme a person picks (System, Light or Dark), shared by the portal, console and
 * verify: one cookie, since cookies ignore ports and the apps share a host. `system` follows the
 * device. The server reads the cookie to render `data-theme` on `<html>` for an explicit choice;
 * for `system`, `THEME_SCRIPT` resolves the device's preference before the first paint.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_COOKIE = 'adili_theme';

/** The preference in a cookie value; `system` for anything else. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The `data-theme` the server can render: the explicit choice, or none for `system`. */
export function serverTheme(preference: ThemePreference): 'light' | 'dark' | undefined {
  return preference === 'system' ? undefined : preference;
}

/**
 * The `<html>` attributes for the preference: `data-theme` and `color-scheme` for an explicit
 * choice, so the first paint is right before any script runs; none for `system`.
 */
export function themeRootProps(preference: ThemePreference): {
  'data-theme'?: 'light' | 'dark';
  style?: { colorScheme: 'light' | 'dark' };
} {
  const theme = serverTheme(preference);
  return theme ? { 'data-theme': theme, style: { colorScheme: theme } } : {};
}

/**
 * Runs in `<head>` before the page paints: sets `data-theme` from the cookie, or from the device
 * for `system`, and follows the device while `system` is chosen. Kept in step with
 * `applyThemePreference`.
 */
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/);var p=m?m[1]:'system';var q=window.matchMedia('(prefers-color-scheme: dark)');var r=document.documentElement;function s(){var t=p==='system'?(q.matches?'dark':'light'):p;r.dataset.theme=t;r.style.colorScheme=t;}s();q.addEventListener('change',function(){if(!/(?:^|; )${THEME_COOKIE}=(light|dark)/.test(document.cookie)){p='system';s();}});}catch(e){}})();`;

/** Stores the preference for a year and applies it to the page at once. */
export function applyThemePreference(preference: ThemePreference): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${THEME_COOKIE}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  const theme =
    preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/**
 * What `THEME_SCRIPT` does, for a page with no server-rendered head (the Keycloak login theme, a
 * client-rendered page on the same host, so it shares the cookie): call before rendering.
 */
export function bootTheme(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const stored = (): ThemePreference =>
    parseThemePreference(new RegExp(`(?:^|; )${THEME_COOKIE}=([a-z]+)`).exec(document.cookie)?.[1]);
  const apply = () => {
    const preference = stored();
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  apply();
  media.addEventListener('change', apply);
}
