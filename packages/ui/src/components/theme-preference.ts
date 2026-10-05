import { createContext } from 'react';

import type { ThemePreference } from '../lib/theme';

/** The preference the server read from the theme cookie; an app's root provides it once. */
export const ThemePreferenceContext = createContext<ThemePreference>('system');
