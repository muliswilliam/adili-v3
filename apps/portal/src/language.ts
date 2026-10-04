import type { Assert, Same } from '@adili/ui';
import { z } from 'zod';

import type { components } from './server/declarations/schema.gen';

/**
 * English or Kiswahili: the languages of Ask Adili, the help pages and the hints (spec 11). The
 * rest of the portal's chrome is English.
 */
export const languageSchema = z.enum(['en', 'sw']);

export type Language = z.infer<typeof languageSchema>;

/** Fails to compile when the contract's `HelpLanguage` and this list drift apart. */
export type LanguageMatchesContract = Assert<Same<Language, components['schemas']['HelpLanguage']>>;
