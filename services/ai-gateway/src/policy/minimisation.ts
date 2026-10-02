/**
 * Minimisation (spec 07c, ADR-007): personal identifiers in a task input are replaced by stable
 * per-job tokens such as `[[PERSON_1]]` or `[[ID_1]]` before the provider request is built, and
 * the tokens in the output are replaced back. The token map lives in the returned closure for the
 * job's duration only: it is never stored, logged or sent anywhere.
 *
 * Task-independent: identifiers are found by where they sit in the input (the declaration.v1
 * field names for names, debtors and creditors, ID numbers, KRA PINs, personnel file numbers,
 * parcel numbers, vehicle registrations, file names, phones, emails and addresses) and by their
 * shape anywhere in free text. Values found in fields are also replaced wherever they recur in
 * free text, in any case and, for codes, with or without spaces and dashes; the token stands for
 * the value as its field holds it. Amounts, dates and item descriptions are left alone: the tasks
 * need them, and the classification gate decides whether they may leave. Over-matching is safe,
 * since every token is restored; it only hides a word from the model.
 *
 * A token in the output that the input never had (the model invented or garbled one) cannot be
 * restored: `restore` throws `UnknownTokenError`, and the job fails as a validation failure
 * rather than storing a placeholder as if it were the record.
 */

export const IDENTIFIER_CLASSES = [
  'PERSON',
  'ID',
  'KRA_PIN',
  'PASSPORT',
  'PHONE',
  'EMAIL',
  'ADDRESS',
  /** A debtor or creditor: a person or a body, kept whole. */
  'PARTY',
  'FILE_NUMBER',
  'PARCEL',
  'REGISTRATION',
  'FILE_NAME',
] as const;
export type IdentifierClass = (typeof IDENTIFIER_CLASSES)[number];

/** Input text that already looks like a token; tokenised too, so it cannot collide. */
type TokenClass = IdentifierClass | 'LITERAL';

export interface Minimised<T> {
  /** The input with identifiers replaced by tokens. */
  input: T;
  /**
   * Replaces the tokens in every string of `output` with what they stand for; throws
   * `UnknownTokenError` for a token this input never had.
   */
  restore: <U>(output: U) => U;
  /** Distinct identifiers replaced, per class; counts only, for telemetry and tests. */
  counts: Partial<Record<TokenClass, number>>;
}

/** The output holds a token the input never had; how many, never which. */
export class UnknownTokenError extends Error {
  override readonly name = 'UnknownTokenError';
  constructor(readonly unknownTokens: number) {
    super(`The output holds ${unknownTokens} token(s) the input never had`);
  }
}

const TOKEN = /\[\[([A-Z][A-Z_]*)_(\d+)\]\]/g;

/** Fields holding a person's name, or part of one (declaration.v1 `PersonName`, co-owners). */
const NAME_FIELDS = new Set(['surname', 'firstName', 'otherNames', 'fullName', 'name', 'coOwner']);
const FIELD_CLASSES: ReadonlyMap<string, IdentifierClass> = new Map([
  ['nationalId', 'ID'],
  ['idNumber', 'ID'],
  ['kraPin', 'KRA_PIN'],
  ['passportNumber', 'PASSPORT'],
  ['passport', 'PASSPORT'],
  ['phone', 'PHONE'],
  ['phoneNumber', 'PHONE'],
  ['mobile', 'PHONE'],
  ['email', 'EMAIL'],
  ['address', 'ADDRESS'],
  ['postalAddress', 'ADDRESS'],
  ['physicalAddress', 'ADDRESS'],
  ['debtor', 'PARTY'],
  ['creditor', 'PARTY'],
  ['personnelFileNumber', 'FILE_NUMBER'],
  ['parcelNumber', 'PARCEL'],
  ['registration', 'REGISTRATION'],
  ['fileName', 'FILE_NAME'],
]);
/**
 * Keys, references and enums the output points back at (source refs, flag ids, item ids) or the
 * prompt relies on; never rewritten, so refs still resolve against the input.
 */
const UNTOUCHED_FIELDS = new Set([
  'id',
  'itemId',
  'personKey',
  'sectionKey',
  'fieldPath',
  'flagId',
  'flagIds',
  'ruleId',
  'schemaVersion',
  'sha256',
  'attachmentId',
  'uploadId',
  'kind',
  'type',
  'language',
]);

/** Shapes of identifiers anywhere in text. `L` and `N` boundaries keep them off longer codes. */
const EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const EDGE_AFTER = String.raw`(?![\p{L}\p{N}])`;
const PATTERNS: readonly { cls: IdentifierClass; pattern: RegExp; group?: number }[] = [
  { cls: 'EMAIL', pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  // A KRA PIN: A or P, nine digits, a letter.
  { cls: 'KRA_PIN', pattern: new RegExp(`${EDGE_BEFORE}[AP]\\d{9}[A-Z]${EDGE_AFTER}`, 'gu') },
  // Kenyan phone numbers (+254 or 0, then 7 or 1 and eight digits), and other international ones.
  {
    cls: 'PHONE',
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}+])(?:(?:\\+?254|0)[\\s-]?[17]\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{3}|\\+\\d{1,3}(?:[\\s-]?\\d){7,12})${EDGE_AFTER}`,
      'gu',
    ),
  },
  // Postal addresses: P.O. Box (Swahili: Sanduku la Posta) or Private Bag, the box, the postal
  // code and the town.
  {
    cls: 'ADDRESS',
    pattern:
      /(?<![\p{L}\p{N}])(?:P\.?\s?O\.?\s*Box|Private\s+Bag|Sanduku\s+la\s+Posta)\s*\d{1,6}(?:\s*-\s*\d{5})?(?:,\s*\p{Lu}\p{L}+)?/giu,
  },
  // Kenyan vehicle registrations (KDK 482M); KES and KSh amounts are not.
  {
    cls: 'REGISTRATION',
    pattern: new RegExp(`${EDGE_BEFORE}K(?!ES|SH)[A-Z]{2}\\s?\\d{3}[A-Z]?${EDGE_AFTER}`, 'gu'),
  },
  // Land parcel numbers: a registration section, its blocks, then the number (KSM/123,
  // KISUMU/MUNICIPALITY BLOCK 7/412).
  {
    cls: 'PARCEL',
    pattern:
      /(?<![\p{L}\p{N}/])\p{Lu}{2,}(?:[ .]\p{Lu}+)*(?:\/[\p{Lu}\p{N}]+(?:[ .][\p{Lu}\p{N}]+)*)*\/\d+(?![\p{L}\p{N}/])/gu,
  },
  // Kenyan passport numbers: one or two letters and seven digits.
  { cls: 'PASSPORT', pattern: new RegExp(`${EDGE_BEFORE}[A-Z]{1,2}\\d{7}${EDGE_AFTER}`, 'gu') },
  {
    cls: 'PASSPORT',
    pattern: /\bpassport(?:\s*(?:no\.?|number|#))?[\s:]*([A-Z0-9]{6,9})(?![\p{L}\p{N}])/giu,
    group: 1,
  },
  // A number named as an ID, in English or Swahili.
  {
    cls: 'ID',
    pattern:
      /\b(?:national\s+id(?:entity)?(?:\s+card)?|identity\s+card|id(?:\s+card)?|i\.d\.|(?:nambari\s+ya\s+)?kitambulisho(?:\s+cha\s+taifa)?)(?:\s*(?:no\.?|number|nambari|namba|#))?[\s:]*(\d{6,9})(?![\p{L}\p{N}])/giu,
    group: 1,
  },
  // A bare seven- or eight-digit number is shaped like a national ID. Amounts stay readable:
  // one after a currency, or with separators, decimals or a percent sign, is left alone, as is
  // a part of a longer code (a UUID's group).
  {
    cls: 'ID',
    pattern:
      /(?<![\p{L}\p{N}.,-]|(?:KES|KSh|Ksh|KShs|Kshs|Shs?|USD|US\$|\$|EUR|GBP)\.?\s?)\d{7,8}(?![\p{L}\p{N}%-]|[.,]\d)/gu,
  },
];

/** Replaces the identifiers in `input` with tokens; see the module comment. */
export function minimise<T>(input: T): Minimised<T> {
  const known = new Map<string, IdentifierClass>();
  collect(input, undefined, known);

  const tokens = new Map<string, string>();
  const values = new Map<string, string>();
  const counters = new Map<TokenClass, number>();
  const tokenFor = (cls: TokenClass, value: string): string => {
    const key = `${cls}\u0000${value}`;
    let token = tokens.get(key);
    if (token === undefined) {
      const n = (counters.get(cls) ?? 0) + 1;
      counters.set(cls, n);
      token = `[[${cls}_${n}]]`;
      tokens.set(key, token);
      values.set(token, value);
    }
    return token;
  };

  const lookup = knownLookup(known);
  const knownPattern = alternation(known);
  const replaceText = (text: string): string => {
    let result = text.replace(TOKEN, (literal) => tokenFor('LITERAL', literal));
    if (knownPattern) {
      result = result.replace(knownPattern, (match) => {
        const found = lookup(match);
        return found ? tokenFor(found.cls, found.value) : match;
      });
    }
    for (const { cls, pattern, group } of PATTERNS) {
      result = result.replace(pattern, (match, ...groups: unknown[]) => {
        if (group === undefined) return tokenFor(cls, match);
        const value = groups[group - 1];
        return typeof value === 'string' ? match.replace(value, tokenFor(cls, value)) : match;
      });
    }
    return result;
  };

  const minimised = mapStrings(input, undefined, replaceText) as T;
  return {
    input: minimised,
    restore: <U>(output: U): U => {
      let unknown = 0;
      const restored = mapStrings(output, undefined, (text) =>
        text.replace(TOKEN, (token) => {
          const value = values.get(token);
          if (value === undefined) unknown++;
          return value ?? token;
        }),
      ) as U;
      if (unknown > 0) throw new UnknownTokenError(unknown);
      return restored;
    },
    counts: Object.fromEntries(counters),
  };
}

/** Gathers the identifiers held in identifier fields, in canonical (sorted key) order. */
function collect(
  value: unknown,
  key: string | undefined,
  known: Map<string, IdentifierClass>,
): void {
  if (key !== undefined && UNTOUCHED_FIELDS.has(key)) return;
  if (typeof value === 'string') {
    const cls = key === undefined ? undefined : fieldClass(key);
    if (cls === 'PERSON') {
      // Each part of a name on its own, so it is found in free text in any order or form.
      for (const word of value.split(/[\s,]+/u)) {
        if (word.length >= 2 && !known.has(word)) known.set(word, 'PERSON');
      }
    } else if (cls !== undefined && value.trim().length >= 2) {
      known.set(value.trim(), cls);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const each of value) collect(each, key, known);
    return;
  }
  if (value !== null && typeof value === 'object') {
    const inAddress = key !== undefined && FIELD_CLASSES.get(key) === 'ADDRESS';
    for (const [childKey, child] of sortedEntries(value)) {
      // Every line of an address object (postal, physical) is part of the address.
      if (inAddress && typeof child === 'string') {
        if (child.trim().length >= 2) known.set(child.trim(), 'ADDRESS');
      } else {
        collect(child, childKey, known);
      }
    }
  }
}

function fieldClass(key: string): IdentifierClass | undefined {
  return NAME_FIELDS.has(key) ? 'PERSON' : FIELD_CLASSES.get(key);
}

/**
 * Classes whose values are codes people write with or without spaces and dashes (`2876 5432`,
 * `PF 2003 001184`); a known one is found in any of those forms.
 */
const COMPACT_CLASSES: ReadonlySet<IdentifierClass> = new Set([
  'ID',
  'KRA_PIN',
  'PASSPORT',
  'PHONE',
  'FILE_NUMBER',
  'REGISTRATION',
]);
const SEPARATORS = /[\s-]+/gu;

/** The form a known value is matched in: any case, and for codes without separators. */
function normalised(value: string, compact: boolean): string {
  const lower = value.toLowerCase();
  return compact ? lower.replace(SEPARATORS, '') : lower;
}

/**
 * Finds the known value (as written in its field) and class behind a match of the known-values
 * pattern; the first value collected wins when two differ only in case or separators.
 */
function knownLookup(
  known: ReadonlyMap<string, IdentifierClass>,
): (match: string) => { value: string; cls: IdentifierClass } | undefined {
  const exact = new Map<string, { value: string; cls: IdentifierClass }>();
  const compact = new Map<string, { value: string; cls: IdentifierClass }>();
  for (const [value, cls] of known) {
    const isCompact = COMPACT_CLASSES.has(cls);
    const map = isCompact ? compact : exact;
    const key = normalised(value, isCompact);
    if (!map.has(key)) map.set(key, { value, cls });
  }
  return (match) => exact.get(normalised(match, false)) ?? compact.get(normalised(match, true));
}

/**
 * One case-insensitive pattern matching any known value as a whole word, longest first so it
 * wins; a code also matches with spaces or dashes between its characters.
 */
function alternation(known: ReadonlyMap<string, IdentifierClass>): RegExp | undefined {
  if (known.size === 0) return undefined;
  const sorted = [...known].sort(([a], [b]) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alternatives = sorted.map(([value, cls]) =>
    COMPACT_CLASSES.has(cls)
      ? Array.from(value.replace(SEPARATORS, ''))
          .map(escape)
          .join(String.raw`[\s-]*`)
      : escape(value),
  );
  return new RegExp(`${EDGE_BEFORE}(?:${alternatives.join('|')})${EDGE_AFTER}`, 'giu');
}

/** A copy of `value` with `map` applied to every string outside the untouched fields. */
function mapStrings(
  value: unknown,
  key: string | undefined,
  map: (text: string) => string,
): unknown {
  if (key !== undefined && UNTOUCHED_FIELDS.has(key)) return value;
  if (typeof value === 'string') return map(value);
  if (Array.isArray(value)) return value.map((each) => mapStrings(each, key, map));
  if (value !== null && typeof value === 'object') {
    // Sorted, so tokens are numbered in the same order the canonical JSON shows them.
    return Object.fromEntries(
      sortedEntries(value).map(([childKey, child]) => [childKey, mapStrings(child, childKey, map)]),
    );
  }
  return value;
}

function sortedEntries(value: object): [string, unknown][] {
  return Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
