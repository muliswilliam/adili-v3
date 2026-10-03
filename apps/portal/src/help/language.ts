import { type Language, languageSchema } from '../language';

/** A help page's `?lang=`: left out for English, anything unknown read as English. */
export const langSearch = languageSchema.optional().catch(undefined);

/** The language a help page is in. */
export const pageLanguage = (lang: Language | undefined): Language => lang ?? 'en';
