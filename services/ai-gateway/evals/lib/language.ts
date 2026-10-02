import type { Language } from '../../src/tasks/common.js';
import { words } from './text.js';

/**
 * English or Swahili by function words. Two languages and reviewer prose make a short list
 * reliable; text under MIN_WORDS words (names, registrations, short labels) is not judged.
 */
export const MIN_WORDS = 15;

const FUNCTION_WORDS: Record<Language, ReadonlySet<string>> = {
  en: new Set(
    'the a an and or of to in on for with by from at as is are was were be been has have had this that these those it its their which not no may should can would since during'.split(
      ' ',
    ),
  ),
  sw: new Set(
    'na ya wa za la cha vya kwa katika ni si kwamba hii hiyo huu hili hizi au pia kuwa wake yake zake lake chake ambayo ambaye ambao tangu kama lakini bado hata kila hadi wala'.split(
      ' ',
    ),
  ),
};

/** The language of `text`, or null when it is too short or neither list dominates. */
export function detectLanguage(text: string): Language | null {
  const tokens = words(text);
  if (tokens.length < MIN_WORDS) return null;
  const count = (language: Language) =>
    tokens.filter((token) => FUNCTION_WORDS[language].has(token)).length;
  const en = count('en');
  const sw = count('sw');
  if (en === sw) return null;
  return en > sw ? 'en' : 'sw';
}
