/**
 * The identifiers a document's text layer gives away by what introduces them, for minimisation
 * (spec 05b). A text layer has no fields to say what is a name, so this reads it as a page reads:
 * a label ("Proprietor:", "Guarantor:", "Jina:"), a title ("Mr.", "Rev.", "Bwana"), a salutation
 * ("Dear", "Mpendwa", "Ndugu") or a formula ("certify that", "Imesainiwa na") introduces the
 * parties after it. Each party is a person, word by word, or, when its name ends in a company
 * word, an organisation, whose other capitalised words are names too. Labelled member numbers and
 * line addresses are found as well.
 *
 * One rule, not a grammar: after a label, every capitalised word to the end of the line, or to the
 * next label, is a name, except numbers, tokens, punctuation, list numbering, offices, titles and
 * a few fillers. After a title, salutation or formula, the run of capitalised words is. The text
 * is read a line and a token at a time, so no pattern backtracks over untrusted input.
 *
 * When in doubt a word is a name: over-matching only hides a word from the model, since every
 * token is restored, while a missed name leaves the platform. What this cannot see (a name with
 * no introducer, a lowercase name, a table's header row) is #504.
 */

import { COUNTIES } from '@adili/forms';

export type DocumentIdentifierClass = 'PERSON' | 'ORGANISATION' | 'MEMBER_NUMBER' | 'ADDRESS';

export interface DocumentIdentifier {
  value: string;
  cls: DocumentIdentifierClass;
}

/** Labels a party's name follows, as patterns; matched in any case. */
const NAME_LABELS = [
  String.raw`(?:full\s+)?names?`,
  String.raw`(?:registered\s+)?proprietors?`,
  String.raw`(?:registered\s+)?owners?(?:'s\s+name)?`,
  'lessees?',
  String.raw`employee(?:\s+name)?`,
  String.raw`account\s+(?:name|holder)`,
  String.raw`customer(?:\s+name)?`,
  'borrowers?',
  String.raw`(?:registered\s+)?holders?`,
  'shareholders?',
  String.raw`member(?:\s+name)?`,
  String.raw`jina(?:\s+kamili)?`,
  'majina',
  'mmiliki',
  'wamiliki',
  'mwanachama',
  // Parties, signatories and witnesses of deeds, charges, guarantees and letters.
  String.raw`signed(?:\s+by)?`,
  'signator(?:y|ies)',
  String.raw`witness(?:es|ed(?:\s+by)?)?`,
  'lessors?',
  'charg(?:ee|or)s?',
  'guarantors?',
  'transfer(?:ee|or)s?',
  'vendors?',
  'purchasers?',
  'spouse',
  'directors?',
  'mdhamini',
  'wadhamini',
  'mkopaji',
  'shahidi',
];
/** Courtesy titles and forms of address, in English and Swahili; matched in any case. */
const TITLES = [
  ...['mr', 'mrs', 'ms', 'mx', 'miss', 'dr', 'dkt', 'prof', 'hon', 'rev', 'revd', 'fr', 'sr'],
  ...['pastor', 'bishop', 'sheikh', 'imam', 'capt', 'cpt', 'col', 'gen', 'maj', 'eng', 'cpa'],
  ...['sir', 'lady', 'madam', 'mzee', 'mama', 'baba', 'bwana', 'bw', 'bibi', 'bi'],
];

const EDGE = String.raw`(?<![\p{L}\p{N}])`;
const AFTER_WORD = String.raw`(?![\p{L}\p{N}])`;
/** A label's numbering or plural: "Borrower 1", "Borrower (1)", "Guarantor(s)". */
const LABEL_VARIANT = String.raw`(?:[ \t]?(?:\(\d{1,2}\)|\d{1,2})|\(s\))?`;
const LABEL = new RegExp(`${EDGE}(?i:${NAME_LABELS.join('|')})${AFTER_WORD}${LABEL_VARIANT}`, 'gu');
/** One to three words that are a label: where a label's span ends ("John Kamau Guarantor: ..."). */
const LABEL_WORDS = new RegExp(`^(?i:${NAME_LABELS.join('|')})$`, 'u');
/** A title, then a dot or a space ("Mr.John", "Rev. Peter"); a salutation or formula, a space. */
const RUN_INTRODUCERS: readonly RegExp[] = [
  new RegExp(`${EDGE}(?i:${TITLES.join('|')})(?:\\.|(?=[ \\t]))`, 'gu'),
  new RegExp(
    `${EDGE}(?i:dear|mpendwa|ndugu|certify[ \\t]+that|imesainiwa[ \\t]+na)(?=[ \\t])`,
    'gu',
  ),
];

/** Words that introduce a run themselves: titles and salutations. */
const INTRODUCER_WORDS = new Set([...TITLES, 'dear', 'mpendwa', 'ndugu']);

/** Every line terminator a text layer may hold, stray carriage returns and separators included. */
const LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/u;

/**
 * A line's tokens, in one linear pass (no alternative backtracks over a long run): an existing
 * token, a run of letters, digits and apostrophes joined by `-` or `/` (a word: Ndung’u-Kamau; a
 * code or number when it holds a digit: UW-00781, 1187), spaces, a joining mark, or any other
 * character.
 */
const TOKEN =
  /\[\[[A-Z][A-Z_]*_\d+\]\]|[\p{L}\p{N}\p{M}'’]+(?:[-/][\p{L}\p{N}\p{M}'’]+)*|[ \t\u00a0]+|[,;/&]|[^]/gu;

type Token = { start: number } & (
  | { kind: 'word'; text: string }
  | { kind: 'space'; width: number }
  | { kind: 'joiner' }
  | { kind: 'colon' }
  | { kind: 'other' }
);

/** A line's tokens, each with where it starts. */
function tokensOf(line: string): Token[] {
  return Array.from(line.matchAll(TOKEN), ({ 0: text, index: start }): Token => {
    if (/^[ \t\u00a0]+$/u.test(text)) return { start, kind: 'space', width: text.length };
    if (/^[,;/&]$/u.test(text)) return { start, kind: 'joiner' };
    if (text === ':') return { start, kind: 'colon' };
    // A code, or a code-like word with a digit, is no name; a hyphenated name is one word.
    if (/^\p{L}/u.test(text) && !/\p{N}/u.test(text)) return { start, kind: 'word', text };
    return { start, kind: 'other' };
  });
}

/** The index of the first token that starts at `offset` or later (tokens are in order). */
function tokenAt(tokens: readonly Token[], offset: number): number {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((tokens[middle]?.start ?? Infinity) < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Words that join two parties, in any case: "and", "or", Swahili "na", "aka", "alias". */
const JOINER_WORDS = new Set(['and', 'or', 'na', 'pia', 'pamoja', 'aka', 'alias']);
/** Lowercase particles inside a name: "Ali bin Hassan", "Kamau wa Ngengi", "Maria de Souza". */
const PARTICLES = new Set([
  'bin',
  'binti',
  'wa',
  'de',
  'da',
  'del',
  'van',
  'von',
  'der',
  'ibn',
  'al',
  'el',
]);
/** Tokens a span reads, words in it, and parties, at most. */
const MAX_TOKENS = 160;
const MAX_WORDS = 24;
const MAX_PARTIES = 8;
/** The longest name word and organisation or address kept: longer is no name, and costly. */
const MAX_WORD_LENGTH = 40;
const MAX_VALUE_LENGTH = 200;

/** Words a company or society's name ends in: "Tumaini Fresh Produce Limited", "Upendo Group". */
const ORGANISATION_WORDS = new Set([
  ...['limited', 'ltd', 'plc', 'company', 'co', 'bank', 'sacco', 'society'],
  ...['holdings', 'enterprises', 'cooperative', 'trust', 'group', 'chama', 'traders'],
]);
/** Offices a name sits next to ("Director Peter Kamau", "Kevin Odera Sacco Secretary"). */
const ROLE_WORDS = new Set([
  ...['secretary', 'treasurer', 'chairperson', 'chairman', 'chairwoman', 'chair', 'manager'],
  ...['officer', 'director', 'accountant', 'clerk', 'registrar', 'advocate', 'trustee'],
  ...['katibu', 'mwenyekiti', 'mhazini', 'mweka'],
]);
/** Words that qualify an office rather than name anyone ("Branch Manager", "Senior Officer"). */
const ROLE_QUALIFIERS = new Set([
  ...['branch', 'senior', 'deputy', 'assistant', 'chief', 'general', 'regional', 'area'],
  ...['operations', 'credit', 'relationship', 'sales', 'finance', 'accounts', 'loans'],
]);
/**
 * Words that start a two-word field label ("Account Type:", "Body Type:", "Date of Registration:"):
 * a span ends before them, as before a one-word one.
 */
const FIELD_LEADS = new Set([
  ...['account', 'body', 'engine', 'year', 'date', 'registration', 'chassis', 'frame', 'loan'],
  ...['branch', 'customer', 'id', 'kra', 'tax', 'phone', 'mobile', 'postal', 'physical'],
]);
/** Capitalised words no one is named ("Owner PIN", "Dear Sir", "the Late"). */
const NOT_NAMES = new Set([
  ...['pin', 'no', 'nos', 'number', 'id', 'kra', 'the', 'of', 'late', 'marehemu'],
  ...TITLES,
]);
/**
 * Places a line below a name may hold (a county or a large town), which the name does not wrap
 * onto: "John Kamau\nNakuru".
 */
const PLACES = new Set([
  ...COUNTIES.flatMap(({ name }) => name.toLowerCase().split(/[\s-]+/u)),
  ...['eldoret', 'thika', 'malindi', 'kitale', 'naivasha', 'nanyuki', 'ruiru', 'kitengela'],
]);

const lower = (word: string) => word.toLowerCase();
const isOrganisationWord = (word: string | undefined) =>
  word !== undefined && ORGANISATION_WORDS.has(lower(word));
/** A word that qualifies an office before it: a company word or a qualifier ("Sacco", "Branch"). */
const qualifiesOffice = (word: string | undefined) =>
  isOrganisationWord(word) || (word !== undefined && ROLE_QUALIFIERS.has(lower(word)));
const isCapitalised = (word: string) => /^\p{Lu}/u.test(word);

/** The word at `index` and the next ones, one space apart, at most `count` of them. */
function wordsFrom(tokens: readonly Token[], index: number, count: number): string[] {
  const words: string[] = [];
  for (let at = index; at < tokens.length && words.length < count; at++) {
    const token = tokens[at];
    if (token?.kind === 'word') words.push(token.text);
    else if (!(token?.kind === 'space' && token.width === 1)) break;
  }
  return words;
}

/** Whether the token after `index` (past spaces) is a colon. */
function colonAfter(tokens: readonly Token[], index: number): boolean {
  for (let at = index + 1; at < tokens.length && at <= index + 2; at++) {
    const token = tokens[at];
    if (token?.kind === 'colon') return true;
    if (token?.kind !== 'space') return false;
  }
  return false;
}

/**
 * Whether the word at `index` labels another field: a word before a colon ("Make:"), or a field
 * label's first word before one more ("Account Type:", "Date of Registration:").
 */
function labelsAField(tokens: readonly Token[], index: number): boolean {
  if (colonAfter(tokens, index)) return true;
  const word = tokens[index];
  if (word?.kind !== 'word' || !FIELD_LEADS.has(lower(word.text))) return false;
  // The field label's next word, past one space and an "of".
  for (let at = index + 1, seen = 0; at < tokens.length && seen < 2; at++) {
    const token = tokens[at];
    if (token?.kind === 'space') continue;
    if (token?.kind !== 'word') return false;
    if (colonAfter(tokens, at)) return true;
    if (token.text !== 'of') seen++;
  }
  return false;
}

/** Whether a label starts at word `index`: one to three words that are a label ("Account Name"). */
function startsLabel(tokens: readonly Token[], index: number): boolean {
  const words = wordsFrom(tokens, index, 3);
  return words.some((_, end) => LABEL_WORDS.test(words.slice(0, end + 1).join(' ')));
}

/**
 * The parties after a label, from token `from`: every capitalised word to the end of the line
 * belongs to one, except where a span ends: at a label, or a capitalised word that labels another
 * field ("Make:"). Lowercase words other than particles, and joiners, end a party.
 */
function labelParties(tokens: readonly Token[], from: number): string[][] {
  const parties: string[][] = [[]];
  const nextParty = () => {
    if ((parties.at(-1)?.length ?? 0) > 0) parties.push([]);
  };
  let words = 0;
  const end = Math.min(tokens.length, from + MAX_TOKENS);
  for (let at = from; at < end && words < MAX_WORDS && parties.length <= MAX_PARTIES; at++) {
    const token = tokens[at];
    if (token?.kind === 'joiner') nextParty();
    if (token?.kind !== 'word') continue;
    const word = token.text;
    if (!isCapitalised(word)) {
      if (!PARTICLES.has(word)) nextParty();
      continue;
    }
    if (startsLabel(tokens, at) || labelsAField(tokens, at)) break;
    if (JOINER_WORDS.has(lower(word))) {
      nextParty();
      continue;
    }
    parties.at(-1)?.push(word);
    words++;
  }
  return parties.filter((party) => party.length > 0);
}

/**
 * The party after a title, salutation or formula, from token `from`: the run of capitalised words
 * and particles, one space apart, up to anything else.
 */
function runParty(tokens: readonly Token[], from: number): string[] {
  const party: string[] = [];
  let at = from;
  while (tokens[at]?.kind === 'space') at++;
  for (; at < tokens.length && party.length < MAX_WORDS; at++) {
    const token = tokens[at];
    if (token?.kind === 'space' && token.width === 1) continue;
    if (token?.kind !== 'word') break;
    if (PARTICLES.has(token.text)) continue;
    // Another title or salutation starts a run of its own.
    if (!isCapitalised(token.text) || INTRODUCER_WORDS.has(lower(token.text))) break;
    if (labelsAField(tokens, at)) break;
    party.push(token.text);
  }
  return party;
}

/**
 * Whether a line continues the name on the line above: it holds a few capitalised words only, and
 * no label, office, company or place.
 */
function continuesName(tokens: readonly Token[]): boolean {
  const words = tokens.filter((token) => token.kind === 'word');
  return (
    words.length > 0 &&
    words.length <= 4 &&
    tokens.every((token) => token.kind === 'word' || token.kind === 'space') &&
    words.every(({ text }) => {
      const word = lower(text);
      return (
        (isCapitalised(text) || PARTICLES.has(text)) &&
        !LABEL_WORDS.test(text) &&
        !ROLE_WORDS.has(word) &&
        !ROLE_QUALIFIERS.has(word) &&
        !ORGANISATION_WORDS.has(word) &&
        !PLACES.has(word)
      );
    })
  );
}

/**
 * A party's identifiers: offices (with the company words and qualifiers before them: "Sacco
 * Secretary", "Branch Manager") and titles dropped wherever they sit, then an organisation when
 * the name ends in a company word, and every capitalised word left a person's name.
 */
function partyIdentifiers(words: readonly string[]): DocumentIdentifier[] {
  const kept: string[] = [];
  for (const word of words) {
    if (ROLE_WORDS.has(lower(word))) {
      while (qualifiesOffice(kept.at(-1))) kept.pop();
      continue;
    }
    if (NOT_NAMES.has(lower(word)) || word.length > MAX_WORD_LENGTH) continue;
    kept.push(word);
  }
  // Each part of a joined name on its own ("Mary-Jane"), so either is found bare.
  const names = kept
    .filter((word) => !isOrganisationWord(word))
    .flatMap((word) => [word, ...(/[-/]/u.test(word) ? word.split(/[-/]/u) : [])])
    .filter((word) => word.length >= 2)
    .map((value): DocumentIdentifier => ({ value, cls: 'PERSON' }));
  const organisation = kept.join(' ');
  return isOrganisationWord(kept.at(-1)) && organisation.length <= MAX_VALUE_LENGTH
    ? [{ value: organisation, cls: 'ORGANISATION' }, ...names]
    : names;
}

/** Whether a label at `index` is one: capitalised, or followed by a colon or dash. */
function isLabel(line: string, index: number, end: number): boolean {
  if (isCapitalised(line.charAt(index))) return true;
  return /^[ \t]*[:-]/u.test(line.slice(end, end + 40));
}

/** Whether no word follows token `from` on its line: the label's value is on a line below. */
function standsAlone(tokens: readonly Token[], from: number): boolean {
  for (let at = from; at < tokens.length; at++) {
    if (tokens[at]?.kind === 'word') return false;
  }
  return true;
}

/** Blank lines a label's value may come after. */
const MAX_BLANK_LINES = 3;

/** The first line below `row` that is not blank, within `MAX_BLANK_LINES`; -1 for none. */
function nextLine(lines: readonly string[], row: number): number {
  for (let at = row + 1; at < lines.length && at <= row + 1 + MAX_BLANK_LINES; at++) {
    if ((lines[at] ?? '').trim() !== '') return at;
  }
  return -1;
}

/**
 * A number a page labels as a person's (membership, payroll, staff, personal, customer or policy
 * number, in English or Swahili), with letters and digits both (UW-00781): a digits-only one is
 * an ID or account number by its shape already, and an ordinal ("5th") is no number.
 */
const MEMBER_NUMBER = new RegExp(
  String.raw`${EDGE}(?i:(?:member(?:ship)?|payroll|staff|personal|employee|customer|policy|tsc)[ \t]+(?:no\.?|number)|nambari[ \t]+ya[ \t]+(?:uanachama|mwanachama|mshahara))[ \t]*(?:[:\-][ \t]*)?([A-Za-z0-9][A-Za-z0-9/-]{2,40})`,
  'gu',
);
const ORDINAL = /^\d+(?:st|nd|rd|th)$/iu;

/** What introduces an address, at the start of a line; the rest of the line is the address. */
const ADDRESS_LABEL = new RegExp(
  String.raw`^[ \t]*(?i:(?:physical|postal|residential|home)[ \t]+address|address|residence|anwani(?:[ \t]+ya[ \t]+makazi)?|makazi)${AFTER_WORD}`,
  'u',
);

/**
 * The identifiers of a text layer, in the order the page holds them; repeats included. `shapes`
 * are the identifiers minimisation finds by their shape (a parcel, a P.O. Box address, an ID):
 * their words are no one's name, so they are blanked before names are read. A document's pages
 * are read as one text, so a label at the foot of a page finds its name at the top of the next.
 */
export function documentIdentifiers(
  text: string,
  shapes: readonly RegExp[] = [],
): DocumentIdentifier[] {
  const found: DocumentIdentifier[] = [];
  const blanked = shapes.reduce(
    (current, shape) => current.replace(shape, (match) => match.replace(/[^\r\n]/gu, ' ')),
    text,
  );
  const lines = text.split(LINE_BREAK);
  const nameLines = blanked.split(LINE_BREAK);
  const tokenised = new Map<number, Token[]>();
  const tokensAt = (row: number): Token[] => {
    let tokens = tokenised.get(row);
    if (!tokens) {
      tokens = tokensOf(nameLines[row] ?? '');
      tokenised.set(row, tokens);
    }
    return tokens;
  };
  const add = (parties: readonly (readonly string[])[]) => {
    for (const party of parties) found.push(...partyIdentifiers(party));
  };

  nameLines.forEach((line, row) => {
    for (const match of line.matchAll(LABEL)) {
      const end = match.index + match[0].length;
      if (!isLabel(line, match.index, end)) continue;
      let at = row;
      const from = tokenAt(tokensAt(row), end);
      let parties = labelParties(tokensAt(row), from);
      if (parties.length === 0) {
        if (!standsAlone(tokensAt(row), from)) continue;
        // The value is on a line below the label, after blank lines at most.
        at = nextLine(nameLines, row);
        if (at < 0) continue;
        parties = labelParties(tokensAt(at), 0);
      }
      add(parties);
      // A name may wrap onto the next line; an office or company it ends in may not.
      const tail = parties.at(-1) ?? [];
      const wraps = !tail.some((word) => ROLE_WORDS.has(lower(word)) || isOrganisationWord(word));
      if (parties.length > 0 && wraps && continuesName(tokensAt(at + 1))) {
        add(labelParties(tokensAt(at + 1), 0));
      }
    }
    for (const introducer of RUN_INTRODUCERS) {
      for (const match of line.matchAll(introducer)) {
        const tokens = tokensAt(row);
        add([runParty(tokens, tokenAt(tokens, match.index + match[0].length))]);
      }
    }
    const original = lines[row] ?? '';
    for (const match of original.matchAll(MEMBER_NUMBER)) {
      const number = match[1] ?? '';
      if (/\p{L}/u.test(number) && /\d/u.test(number) && !ORDINAL.test(number)) {
        found.push({ value: number, cls: 'MEMBER_NUMBER' });
      }
    }
    const address = ADDRESS_LABEL.exec(original);
    if (address) {
      // The address, or the line below a label that stands alone.
      const rest = original
        .slice(address[0].length)
        .replace(/^[ \t]*(?:[:-][ \t]*)?/u, '')
        .trim();
      const below = nextLine(lines, row);
      const value = (rest === '' && below >= 0 ? (lines[below] ?? '').trim() : rest).slice(
        0,
        MAX_VALUE_LENGTH,
      );
      if (value.length >= 2) found.push({ value, cls: 'ADDRESS' });
    }
  });
  return found;
}
