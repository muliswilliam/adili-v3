import { z } from 'zod';

/** English or Kiswahili: the languages of the help, Ask Adili and the hints (`HelpLanguage`). */
export const languageSchema = z.enum(['en', 'sw']);

export type Language = z.infer<typeof languageSchema>;

/** A help page's `?lang=`: left out for English, anything unknown read as English. */
export const langSearch = languageSchema.optional().catch(undefined);

/** The language a help page is in. */
export const pageLanguage = (lang: Language | undefined): Language => lang ?? 'en';
