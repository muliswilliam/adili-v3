/**
 * The "no number absent from the input" check (spec 07c S9). A number in the output passes when
 * it equals a number in the input in any written form: amounts in shillings rather than cents,
 * with separators or a scale word ("18 million", "milioni 18"), percentages, date parts. Small
 * counts and the Act's own references are allowed. Rounded or derived figures fail: a reviewer
 * needs the exact amounts, and rounding is how an invented number slips through.
 */

const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  elfu: 1e3,
  m: 1e6,
  million: 1e6,
  milioni: 1e6,
  bn: 1e9,
  billion: 1e9,
  bilioni: 1e9,
};

/** Swahili writes the scale word before the number: "milioni 18". */
const PREFIX_SCALES = new Set(['elfu', 'milioni', 'bilioni']);

/** Bare counts ("two vehicles", "3 flags") need no source; a percentage or amount does. */
const MAX_FREE_COUNT = 10;

/** Act sections, thresholds and the Act's year, which the prompts may cite. */
const LEGAL_REFERENCES = [4, 25, 31, 35, 100, 2025];

/** Minor-unit amounts: the input holds cents, the text uses whole units. */
const MINOR_UNIT_KEYS = new Set(['kesCents', 'minorUnits']);

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const NUMBER =
  /(?:\b(elfu|milioni|bilioni)\s+)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(%|percent\b|asilimia\b))?(?:\s*(k|thousand|m|million|bn|billion)\b)?/giu;

/** A currency or Swahili "asilimia" just before a number: "KES 5", "asilimia 8". */
const UNIT_BEFORE = /\b(?:kes|kshs?|usd|eur|gbp|shilingi|sh|asilimia)\.?\s*$/iu;

interface NumberMention {
  value: number;
  text: string;
  /** Written with a percent sign, a scale word or a currency: an amount, not a count. */
  hasUnit: boolean;
}

function mentions(text: string): NumberMention[] {
  return [...text.matchAll(NUMBER)].map((match) => {
    const [whole, prefix, integer = '', fraction] = match;
    const suffix = match[5];
    const base = Number(`${integer.replaceAll(',', '')}${fraction ? `.${fraction}` : ''}`);
    const scaleWord = (prefix ?? suffix)?.toLowerCase();
    const scale =
      scaleWord && (prefix ? PREFIX_SCALES.has(scaleWord) : true) ? SCALES[scaleWord] : 1;
    const hasUnit =
      Boolean(prefix ?? match[4] ?? suffix) || UNIT_BEFORE.test(text.slice(0, match.index));
    return { value: base * (scale ?? 1), text: whole.trim(), hasUnit };
  });
}

/** The numbers written in a text, scale words applied. */
export function numbersIn(text: string): number[] {
  return mentions(text).map((mention) => mention.value);
}

/** Every number the input states, in the units a reader would see. */
function inputNumbers(value: unknown, key?: string): number[] {
  if (typeof value === 'number') {
    return key && MINOR_UNIT_KEYS.has(key) ? [value, value / 100] : [value];
  }
  if (typeof value === 'string') return UUID.test(value) ? [] : numbersIn(value);
  if (Array.isArray(value)) return value.flatMap((item) => inputNumbers(item));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([entryKey, item]) => inputNumbers(item, entryKey));
  }
  return [];
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function isFree({ value, hasUnit }: NumberMention): boolean {
  return (
    (!hasUnit && Number.isInteger(value) && value >= 0 && value <= MAX_FREE_COUNT) ||
    LEGAL_REFERENCES.includes(value)
  );
}

/** The numbers in `text`, as written, that the input does not contain in any form. */
export function foreignNumbers(text: string, input: unknown): string[] {
  const known = inputNumbers(input);
  return mentions(text)
    .filter((mention) => !isFree(mention) && !known.some((each) => same(each, mention.value)))
    .map((mention) => mention.text);
}
