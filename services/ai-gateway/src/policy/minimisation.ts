import { documentIdentifiers, recurrenceOf } from './document-identifiers.js';

/**
 * Minimisation (spec 07c, ADR-007): personal identifiers in a task input are replaced by stable
 * per-job tokens such as `[[PERSON_1]]` or `[[ID_1]]` before the provider request is built, and
 * the tokens in the output are replaced back. The token map lives in the returned closure for the
 * job's duration only: it is never stored, logged or sent anywhere.
 *
 * Task-independent: identifiers are found by where they sit in the input (the declaration.v1
 * field names for names, debtors and creditors, ID numbers, KRA PINs, personnel file numbers,
 * parcel numbers, vehicle registrations, file names, phones, emails, addresses, and dates and
 * places of birth) and by their shape anywhere in free text. Values found in fields are also
 * replaced wherever they recur in free text, in any case and, for codes, with or without spaces
 * and dashes; the token stands for the value as its field holds it. Amounts, other dates and item
 * descriptions are left alone: the tasks need them, and the classification gate decides whether
 * they may leave. The exception is what a
 * declarant asks in their own words (`QUESTION_FIELDS`): Ask Adili needs no figure, and never
 * receives one (spec 11), so amounts there are tokens too. Over-matching is safe, since every token
 * is restored; it only hides a word from the model.
 *
 * A document's text layer (`DOCUMENT_TEXT_FIELDS`, spec 05b) has no fields to say what is a name:
 * `documentIdentifiers` reads what its labels, titles and salutations introduce, and those are
 * replaced wherever they recur.
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
  'BIRTH_DATE',
  'BIRTH_PLACE',
  'ACCOUNT',
  /** A membership, payroll or staff number a document labels (UW-00781). */
  'MEMBER_NUMBER',
  /** A company or society a document names as a party ("Borrower: Tumaini Produce Limited"). */
  'ORGANISATION',
] as const;
export type IdentifierClass = (typeof IDENTIFIER_CLASSES)[number];

/**
 * An amount in a declarant's question; input text that already looks like a token, tokenised too
 * so it cannot collide.
 */
type TokenClass = IdentifierClass | 'AMOUNT' | 'LITERAL';

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
  ['dateOfBirth', 'BIRTH_DATE'],
]);
/** Objects whose lines are each an identifier of the given class (declaration.v1 `birth`). */
const OBJECT_FIELDS: ReadonlyMap<string, ReadonlyMap<string, IdentifierClass>> = new Map([
  [
    'birth',
    new Map<string, IdentifierClass>([
      ['date', 'BIRTH_DATE'],
      ['place', 'BIRTH_PLACE'],
    ]),
  ],
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

/**
 * A bank account number: a run of ten to sixteen digits, or three or four groups of four. An
 * amount after a currency, or with separators or decimals, is not one, nor are a longer code's
 * digits (a chassis number's).
 */
const ACCOUNT_NUMBER =
  /(?<![\p{L}\p{N}.,-]|(?:KES|KSh|Ksh|KShs|Kshs|Shs?|USD|US\$|\$|EUR|GBP)\.?\s?)(?:\d{10,16}|\d{4}(?:[ -]\d{4}){2,3})(?![\p{L}\p{N}%-]|[.,]\d)/u;

/** Whether `text` holds a bank account number, as minimisation finds one. */
export function holdsAccountNumber(text: string): boolean {
  return ACCOUNT_NUMBER.test(text);
}

/** Shapes of identifiers anywhere in text. `L` and `N` boundaries keep them off longer codes. */
const EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const EDGE_AFTER = String.raw`(?![\p{L}\p{N}])`;
const PATTERNS: readonly { cls: IdentifierClass; pattern: RegExp; group?: number }[] = [
  // An email, matched from the start of its run only, and its domain label by label, so a long
  // run of letters and dots takes linear time.
  {
    cls: 'EMAIL',
    pattern: /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]*\.)+\p{L}{2,}/gu,
  },
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
  // Bank account numbers: a run of ten to sixteen digits, or three or four groups of four.
  // Amounts after a currency, or with separators or decimals, are left alone as below.
  { cls: 'ACCOUNT', pattern: new RegExp(ACCOUNT_NUMBER.source, 'gu') },
  // A bare seven- or eight-digit number is shaped like a national ID. Amounts stay readable:
  // one after a currency, or with separators, decimals or a percent sign, is left alone, as is
  // a part of a longer code (a UUID's group).
  {
    cls: 'ID',
    pattern:
      /(?<![\p{L}\p{N}.,-]|(?:KES|KSh|Ksh|KShs|Kshs|Shs?|USD|US\$|\$|EUR|GBP)\.?\s?)\d{7,8}(?![\p{L}\p{N}%-]|[.,]\d)/gu,
  },
];

/** The shapes' patterns: what a document's names are read around (`documentIdentifiers`). */
const SHAPES = PATTERNS.map(({ pattern }) => pattern);

/**
 * Fields holding what a declarant asks in their own words (Ask Adili's `question` and earlier
 * turns), where amounts are replaced as well as identifiers.
 */
const QUESTION_FIELDS = new Set(['question', 'history']);

/**
 * Fields holding a document's text layer, where the identifiers its labels, titles and
 * salutations introduce are found (`documentIdentifiers`, spec 05b).
 */
const DOCUMENT_TEXT_FIELDS = new Set(['textLayer']);

const CURRENCY = String.raw`(?:KES|KShs?|Kshs?|Shs?|USD|US\$|\$|EUR|€|GBP|£)\.?`;
const NUMBER = String.raw`\d+(?:[.,]\d+)*`;
const SCALE = String.raw`(?:million|billion|thousand|mn|bn|m|k)`;
const CURRENCY_WORD = String.raw`(?:shillings?|bob|dollars?|euros?|pounds?|KES|KSh)`;
/**
 * An amount, in English or Swahili: after a currency (KES 3 million, $500), before a currency word
 * (120k bob, 2,500,000 shillings), with a scale word (3 million, shilingi milioni 3), or in
 * thousands groups (1,200,000). A bare number (a year, a count, a section) is not one.
 */
const AMOUNT = new RegExp(
  `${EDGE_BEFORE}(?:` +
    [
      String.raw`${CURRENCY}\s?${NUMBER}(?:\s?${SCALE}${EDGE_AFTER})?`,
      String.raw`${NUMBER}\s?(?:${SCALE}\s?)?${CURRENCY_WORD}`,
      String.raw`${NUMBER}\s?(?:million|billion|thousand)`,
      String.raw`(?:shilingi\s+)?(?:milioni|bilioni|elfu)\s+${NUMBER}`,
      String.raw`shilingi\s+${NUMBER}`,
      String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?`,
    ].join('|') +
    `)${EDGE_AFTER}`,
  'giu',
);

/** Where a string sits: a declarant's question, a document's text layer, or anywhere else. */
type TextKind = 'question' | 'document' | 'plain';

/** Classes that are names: replaced in a document's text after its shapes. */
const NAME_CLASSES: ReadonlySet<IdentifierClass> = new Set(['PERSON', 'ORGANISATION', 'PARTY']);

/** Replaces the identifiers in `input` with tokens; see the module comment. */
export function minimise<T>(input: T): Minimised<T> {
  const known = new Map<string, IdentifierClass>();
  const documentTexts: string[] = [];
  collect(input, undefined, known, documentTexts);
  // A document's pages are read as one text, so a label at a page's foot finds its name on the
  // next. The names a page gives are matched in every case, except common words ("Grace",
  // "Upendo"), matched only as written, capitalised or in capitals, and words known to be no
  // one's name ("Branch", "Nakuru"), matched only as written: a trade of a little privacy for
  // prose that stays readable (#504).
  const written = new Map<string, IdentifierClass>();
  for (const { value, cls } of documentIdentifiers(documentTexts.join('\n'), SHAPES)) {
    const recurrence = cls === 'PERSON' ? recurrenceOf(value) : 'any';
    if (recurrence !== 'any') {
      const forms = recurrence === 'exact' ? [value] : writtenForms(value);
      for (const form of forms) if (!written.has(form)) written.set(form, cls);
    } else if (!known.has(value)) {
      known.set(value, cls);
    }
  }

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
  const writtenPattern = writtenAlternation(written);
  // A document's text: codes and addresses it labels, then shapes, then names, so a name inside
  // an email or phone number is not cut out of it ("John.Kamau@KamauLaw.co.ke").
  const codes = new Map([...known].filter(([, cls]) => !NAME_CLASSES.has(cls)));
  const names = new Map([...known].filter(([, cls]) => NAME_CLASSES.has(cls)));
  const codeLookup = knownLookup(codes);
  const codePattern = alternation(codes);
  const nameLookup = knownLookup(names);
  const namePattern = alternation(names);
  const replaceKnown = (
    text: string,
    pattern: RegExp | undefined,
    find: ReturnType<typeof knownLookup>,
  ): string =>
    pattern
      ? text.replace(pattern, (match) => {
          const found = find(match);
          return found ? tokenFor(found.cls, found.value) : match;
        })
      : text;
  const replaceWritten = (text: string): string =>
    writtenPattern
      ? text.replace(writtenPattern, (match) => {
          const cls = written.get(match);
          return cls ? tokenFor(cls, match) : match;
        })
      : text;
  const replaceShapes = (text: string): string => {
    let result = text;
    for (const { cls, pattern, group } of PATTERNS) {
      result = result.replace(pattern, (match, ...groups: unknown[]) => {
        if (group === undefined) return tokenFor(cls, match);
        const value = groups[group - 1];
        return typeof value === 'string' ? match.replace(value, tokenFor(cls, value)) : match;
      });
    }
    return result;
  };
  const replaceText = (text: string, kind: TextKind): string => {
    let result = text.replace(TOKEN, (literal) => tokenFor('LITERAL', literal));
    if (kind === 'question')
      result = result.replace(AMOUNT, (amount) => tokenFor('AMOUNT', amount));
    if (kind === 'document') {
      result = replaceShapes(replaceKnown(result, codePattern, codeLookup));
      return replaceWritten(replaceKnown(result, namePattern, nameLookup));
    }
    // After the known values, so an organisation's whole name is one token before its words.
    return replaceShapes(replaceWritten(replaceKnown(result, knownPattern, lookup)));
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
  documentTexts: string[],
): void {
  if (key !== undefined && UNTOUCHED_FIELDS.has(key)) return;
  if (typeof value === 'string') {
    const cls = key === undefined ? undefined : fieldClass(key);
    if (cls === 'PERSON') {
      collectName(value, known);
    } else if (key !== undefined && DOCUMENT_TEXT_FIELDS.has(key)) {
      documentTexts.push(value);
    } else if (cls !== undefined && value.trim().length >= 2) {
      known.set(value.trim(), cls);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const each of value) collect(each, key, known, documentTexts);
    return;
  }
  if (value !== null && typeof value === 'object') {
    const inAddress = key !== undefined && FIELD_CLASSES.get(key) === 'ADDRESS';
    const lines = key === undefined ? undefined : OBJECT_FIELDS.get(key);
    for (const [childKey, child] of sortedEntries(value)) {
      // Every line of an address object (postal, physical) is part of the address.
      const lineClass = inAddress ? 'ADDRESS' : lines?.get(childKey);
      if (lineClass !== undefined && typeof child === 'string') {
        if (child.trim().length >= 2) known.set(child.trim(), lineClass);
      } else {
        collect(child, childKey, known, documentTexts);
      }
    }
  }
}

/** Each part of a name on its own, so it is found in free text in any order or form. */
function collectName(name: string, known: Map<string, IdentifierClass>): void {
  for (const word of name.split(/[\s,]+/u)) {
    if (word.length >= 2 && !known.has(word)) known.set(word, 'PERSON');
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
  'MEMBER_NUMBER',
  'ID',
  'KRA_PIN',
  'PASSPORT',
  'PHONE',
  'ACCOUNT',
  'FILE_NUMBER',
  'REGISTRATION',
]);
const SEPARATORS = /[\s-]+/gu;

/** The form a known value is matched in: any case, and for codes without separators. */
function normalised(value: string, compact: boolean): string {
  const lower = value.toLowerCase();
  return compact ? lower.replace(SEPARATORS, '') : lower;
}

/** A Kenyan number's country (+254, 254) or trunk (0) prefix, before its nine digits. */
const KENYAN_PREFIX = /^(?:254|0)(?=\d{9}$)/u;

/**
 * A phone number as matched: its digits, a Kenyan one without its prefix, so `+254 712 345 678`,
 * `254712345678` and `0712 345 678` are one number.
 */
function phoneDigits(value: string): string {
  return value.replace(/\D/gu, '').replace(KENYAN_PREFIX, '');
}

/**
 * Finds the known value (as written in its field) and class behind a match of the known-values
 * pattern; the first value collected wins when two differ only in case, separators or (a phone
 * number) its prefix.
 */
function knownLookup(
  known: ReadonlyMap<string, IdentifierClass>,
): (match: string) => { value: string; cls: IdentifierClass } | undefined {
  const exact = new Map<string, { value: string; cls: IdentifierClass }>();
  const compact = new Map<string, { value: string; cls: IdentifierClass }>();
  const phones = new Map<string, { value: string; cls: IdentifierClass }>();
  for (const [value, cls] of known) {
    const isCompact = COMPACT_CLASSES.has(cls);
    const [map, key] =
      cls === 'PHONE' && /\d/u.test(value)
        ? [phones, phoneDigits(value)]
        : [isCompact ? compact : exact, normalised(value, isCompact)];
    if (!map.has(key)) map.set(key, { value, cls });
  }
  return (match) =>
    exact.get(normalised(match, false)) ??
    compact.get(normalised(match, true)) ??
    phones.get(phoneDigits(match));
}

/**
 * The pattern of a known phone number: its digits with spaces or dashes between them, a Kenyan
 * one after any of its prefixes (+254, 254, 0).
 */
function phoneAlternative(value: string): string {
  const separated = (digits: string) => Array.from(digits).join(String.raw`[\s-]*`);
  const digits = value.replace(/\D/gu, '');
  const core = phoneDigits(value);
  if (core === digits) {
    // Not Kenyan: as written, with its + if any.
    return (value.trim().startsWith('+') ? String.raw`\+[\s-]*` : '') + separated(digits);
  }
  return String.raw`(?:\+?[\s-]*${separated('254')}|0)[\s-]*` + separated(core);
}

/**
 * One case-insensitive pattern matching any known value as a whole word, longest first so it
 * wins; a code also matches with spaces or dashes between its characters.
 */
/** `text` as a pattern that matches it literally. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A name as a page writes it: as found, capitalised, and in capitals ("Kamau", "KAMAU"). */
function writtenForms(value: string): string[] {
  const capitalised = value.replace(
    /(^|[\s-])(\p{L})(\p{L}*)/gu,
    (_, before: string, first: string, rest: string) =>
      `${before}${first.toUpperCase()}${rest.toLowerCase()}`,
  );
  return [...new Set([value, capitalised, value.toUpperCase()])];
}

/** One case-sensitive pattern matching any written form as a whole word, longest first. */
function writtenAlternation(written: ReadonlyMap<string, IdentifierClass>): RegExp | undefined {
  if (written.size === 0) return undefined;
  const sorted = [...written.keys()].sort(
    (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  return new RegExp(`${EDGE_BEFORE}(?:${sorted.map(escape).join('|')})${EDGE_AFTER}`, 'gu');
}

function alternation(known: ReadonlyMap<string, IdentifierClass>): RegExp | undefined {
  if (known.size === 0) return undefined;
  const sorted = [...known].sort(([a], [b]) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const alternatives = sorted.map(([value, cls]) =>
    // A phone field without digits ("none") is matched as written.
    cls === 'PHONE' && /\d/u.test(value)
      ? phoneAlternative(value)
      : COMPACT_CLASSES.has(cls)
        ? Array.from(value.replace(SEPARATORS, ''))
            .map(escape)
            .join(String.raw`[\s-]*`)
        : escape(value),
  );
  return new RegExp(`${EDGE_BEFORE}(?:${alternatives.join('|')})${EDGE_AFTER}`, 'giu');
}

/**
 * A copy of `value` with `map` applied to every string outside the untouched fields, told whether
 * the string is in a question field.
 */
function mapStrings(
  value: unknown,
  key: string | undefined,
  map: (text: string, kind: TextKind) => string,
  inQuestion = false,
): unknown {
  if (key !== undefined && UNTOUCHED_FIELDS.has(key)) return value;
  const question = inQuestion || (key !== undefined && QUESTION_FIELDS.has(key));
  if (typeof value === 'string') {
    if (question) return map(value, 'question');
    return map(value, key !== undefined && DOCUMENT_TEXT_FIELDS.has(key) ? 'document' : 'plain');
  }
  if (Array.isArray(value)) return value.map((each) => mapStrings(each, key, map, question));
  if (value !== null && typeof value === 'object') {
    // Sorted, so tokens are numbered in the same order the canonical JSON shows them.
    return Object.fromEntries(
      sortedEntries(value).map(([childKey, child]) => [
        childKey,
        mapStrings(child, childKey, map, question),
      ]),
    );
  }
  return value;
}

function sortedEntries(value: object): [string, unknown][] {
  return Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
