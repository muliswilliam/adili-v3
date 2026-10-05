/**
 * The shape the portal's copy tables share (`labels.ts` for the declaration's enumerations,
 * `copy.ts` for the sentences of spec 05b): every entry has English and a Swahili slot of the
 * same shape, empty until the Swahili copy is done. Screens read English, through `english`.
 */

/** A word or sentence: English, and a Swahili slot. */
export interface Label {
  en: string;
  /** Empty until translated. */
  sw: string;
}

/** Copy with values: English, and a Swahili slot of the same shape, empty until translated. */
export interface Phrase<A extends unknown[]> {
  en: (...args: A) => string;
  /** Empty until translated. */
  sw: ((...args: A) => string) | '';
}

/** An entry with English only so far: its Swahili slot is empty. */
export function en(text: string): Label;
export function en<A extends unknown[]>(text: (...args: A) => string): Phrase<A>;
export function en<T>(text: T): { en: T; sw: '' } {
  return { en: text, sw: '' };
}

/** A table of entries, read in English. */
export type English<T> = { [K in keyof T]: T[K] extends { en: infer E } ? E : never };

/** A table's English: each entry's `en`, by the same keys. */
export function english<T extends Record<string, { en: unknown; sw: unknown }>>(
  table: T,
): English<T> {
  return Object.fromEntries(
    Object.entries(table).map(([key, entry]) => [key, entry.en]),
  ) as English<T>;
}

export type Language = 'en' | 'sw';

/** A table read in a language: each entry's Swahili, or its English while the slot is empty. */
export function inLanguage<T extends Record<string, { en: unknown; sw: unknown }>>(
  table: T,
  language: Language,
): English<T> {
  return Object.fromEntries(
    Object.entries(table).map(([key, entry]) => [
      key,
      language === 'sw' && entry.sw !== '' ? entry.sw : entry.en,
    ]),
  ) as English<T>;
}
