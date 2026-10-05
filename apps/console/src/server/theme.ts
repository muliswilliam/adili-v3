import { parseThemePreference, THEME_COOKIE, type ThemePreference } from '@adili/ui';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';

/** The colour theme the person picked (the shared theme cookie), `system` when none. */
export const getTheme = createServerFn({ method: 'GET' }).handler((): ThemePreference =>
  parseThemePreference(getCookie(THEME_COOKIE)),
);
