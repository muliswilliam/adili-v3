import { COUNTIES } from '@adili/forms';

/**
 * The identifiers a document's text layer gives away by what introduces them, for minimisation
 * (spec 05b). A text layer has no fields to say what is a name, so this reads it as a page reads:
 * a label ("Proprietor:", "Guarantor:", "Jina:"), a title ("Mr.", "Rev.", "Bwana"), a salutation
 * ("Dear", "Mpendwa", "Ndugu") or a formula ("certify that", "Imesainiwa na") introduces the
 * parties after it. Each party is a person, word by word, or, when its name ends in a company
 * word, an organisation, whose other capitalised words are names too. Labelled member numbers and
 * line addresses are found as well.
 *
 * One rule, not a grammar: after a label, every capitalised word to the end of the line is a name,
 * except offices, titles and a few fillers (numbers, tokens and punctuation are skipped). A span
 * ends only at a word positively known to end it: another label, a field word ("Make", "Salary",
 * "ID"), or a currency; never at an unknown word, a colon or trailing data. Under a stand-alone
 * label, every listed line is read the same way. After a title, salutation or formula, the run of
 * capitalised words is a name. The text is read a line and a token at a time, so no pattern
 * backtracks over untrusted input.
 *
 * When in doubt a word is a name: over-matching only hides a word from the model, since every
 * token is restored, while a missed name leaves the platform. What this cannot see (a name with
 * no introducer, a lowercase name, a table's header row) is #504.
 */

export type DocumentIdentifierClass =
  'PERSON' | 'ORGANISATION' | 'MEMBER_NUMBER' | 'ACCOUNT' | 'ADDRESS';

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
/**
 * Short titles, which no one is named: a run's span ends at one ("Dear Mr. Ouma").
 */
const SHORT_TITLES = [
  ...['mr', 'mrs', 'ms', 'mx', 'miss', 'dr', 'dkt', 'prof', 'hon', 'rev', 'revd', 'fr', 'sr'],
  ...['capt', 'cpt', 'col', 'gen', 'maj', 'eng', 'cpa', 'bw'],
];
/**
 * Courtesy titles and forms of address, in English and Swahili, matched in any case: the short
 * ones, and words that are also surnames (Mama, Baba, Bibi, Bwana, Mzee), which inside a run are.
 */
const TITLES = [
  ...SHORT_TITLES,
  ...['pastor', 'bishop', 'sheikh', 'imam', 'sir', 'lady', 'madam', 'mzee', 'mama', 'baba'],
  ...['bwana', 'bibi', 'bi'],
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

/** Words that introduce a run themselves, where a run ends: short titles and salutations. */
const INTRODUCER_WORDS = new Set([...SHORT_TITLES, 'dear', 'mpendwa', 'ndugu']);

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
  | { kind: 'number'; text: string }
  | { kind: 'other'; text: string }
);

/** A line's tokens, each with where it starts. */
function tokensOf(line: string): Token[] {
  return Array.from(line.matchAll(TOKEN), ({ 0: text, index: start }): Token => {
    if (/^[ \t\u00a0]+$/u.test(text)) return { start, kind: 'space', width: text.length };
    if (/^[,;/&]$/u.test(text)) return { start, kind: 'joiner' };
    if (text === ':') return { start, kind: 'colon' };
    // A code, or a code-like word with a digit, is no name; a hyphenated name is one word.
    if (/^\p{L}/u.test(text) && !/\p{N}/u.test(text)) return { start, kind: 'word', text };
    if (/^\p{N}+$/u.test(text)) return { start, kind: 'number', text };
    return { start, kind: 'other', text };
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

/** Currencies, in any case: KES 12,500,000 is no one's name, and ends a name's span. */
const CURRENCIES: ReadonlySet<string> = new Set([
  ...['kes', 'ksh', 'kshs', 'sh', 'shs', 'usd', 'eur', 'gbp', 'tsh', 'tzs', 'ush', 'ugx'],
]);

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
/** An office before a colon introduces who holds it ("Chairman: John Kamau"), as a label. */
const OFFICE_LABEL = new RegExp(
  `${EDGE}(?i:${[...ROLE_WORDS].join('|')})${AFTER_WORD}(?=[ \\t]*:)`,
  'gu',
);
/** Words that qualify an office rather than name anyone ("Branch Manager", "Senior Officer"). */
const ROLE_QUALIFIERS = new Set([
  ...['branch', 'senior', 'deputy', 'assistant', 'chief', 'general', 'regional', 'area'],
  ...['operations', 'credit', 'relationship', 'sales', 'finance', 'accounts', 'loans'],
]);
/** Capitalised words no one is named ("Owner PIN", "Dear Sir", "the Late"). */
const NOT_NAMES = new Set([
  ...['pin', 'no', 'nos', 'number', 'id', 'kra', 'the', 'of', 'late', 'marehemu', 'sir', 'madam'],
  ...CURRENCIES,
  ...SHORT_TITLES,
  // A document's own headings, which a label at a page's foot may run into ("TITLE DEED").
  ...['title', 'deed', 'certificate', 'lease', 'republic', 'kenya', 'page', 'register'],
]);
/**
 * Words that label a field of their own on a form ("Make:", "Station:", "Salary"): one ends a
 * name's span, with or without a colon; any other capitalised word is part of the name, before a
 * colon too ("John Kamau: Chairman").
 */
const FIELD_WORDS = new Set([
  ...['make', 'model', 'colour', 'color', 'year', 'type', 'fuel', 'engine', 'body', 'chassis'],
  ...['frame', 'rating', 'section', 'station', 'branch', 'district', 'county', 'location'],
  ...['area', 'size', 'use', 'term', 'tenure', 'date', 'amount', 'balance', 'currency'],
  ...['status', 'tel', 'telephone', 'phone', 'mobile', 'email', 'address', 'designation'],
  ...['department', 'employer', 'institution', 'account', 'loan', 'ref', 'reference', 'pin'],
  ...['id', 'signature', 'sahihi', 'tarehe', 'kiasi', 'salio', 'cheo', 'idara', 'simu'],
  ...['gender', 'nationality', 'occupation', 'grade', 'salary', 'pay', 'shares', 'value'],
  ...['purpose', 'parcel', 'village', 'ward', 'plot'],
]);
/**
 * Words that start a field label of two words or more ("Account Type:", "Basic Salary:", "Date of
 * Registration:"): a span ends before them, as before a one-word one.
 */
const FIELD_LEADS = new Set([
  ...FIELD_WORDS,
  ...['registration', 'customer', 'kra', 'tax', 'postal', 'physical', 'basic', 'gross', 'net'],
  ...['job', 'total'],
]);
/** Words before "Name" that make it another field's name ("Bank Name:", "Employer Name:"). */
const NAMED_FIELDS = new Set([
  ...['bank', 'branch', 'employer', 'business', 'company', 'trading', 'institution', 'school'],
  ...['station', 'sacco', 'society', 'group', 'chama', 'project', 'product', 'file', 'street'],
]);
/**
 * Common English and Swahili words that are also names ("Grace", "Upendo", "Make"): a name a page
 * gives that is one of them is matched only as written, capitalised or in capitals, so the word in
 * prose stays readable. Any other name is matched in every case, as privacy asks.
 */
const COMMON_WORDS = new Set([
  ...['make', 'model', 'use', 'account', 'registration', 'grace', 'faith', 'hope', 'joy'],
  ...['mercy', 'patience', 'rose', 'fresh', 'produce', 'women', 'youth', 'trading', 'farm'],
  ...['farmers', 'general', 'united', 'new', 'star', 'best', 'green', 'golden', 'royal'],
  ...['amani', 'imani', 'baraka', 'neema', 'upendo', 'tumaini', 'furaha', 'bahati', 'rehema'],
  ...['baba', 'mama', 'bibi', 'tel', 'shares', 'total', 'value', 'purpose', 'male', 'female'],
]);

/** Whether a name word is also a common word, matched only as a page writes it. */
export function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase());
}
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

/** The index of the colon after word `index` (past spaces), or -1. */
function colonAfter(tokens: readonly Token[], index: number): number {
  for (let at = index + 1; at < tokens.length && at <= index + 2; at++) {
    const token = tokens[at];
    if (token?.kind === 'colon') return at;
    if (token?.kind !== 'space') return -1;
  }
  return -1;
}

/**
 * Whether the word at `index` labels another field, which ends a name's span: a field word
 * ("Make", "Salary", "ID"), with or without a colon, or a field label's first word before one or
 * two more and a colon ("Account Type:", "Date of Registration:"). Nothing else does, not even a
 * colon after a name ("John Kamau: Chairman"): when in doubt, a word is a name.
 */
function labelsAField(tokens: readonly Token[], index: number): boolean {
  const word = tokens[index];
  if (word?.kind !== 'word') return false;
  if (FIELD_WORDS.has(lower(word.text))) return true;
  if (!FIELD_LEADS.has(lower(word.text))) return false;
  // The field label's next words, past spaces and an "of", up to its colon.
  for (let at = index + 1, seen = 0; at < tokens.length && seen < 2; at++) {
    const token = tokens[at];
    if (token?.kind === 'space') continue;
    if (token?.kind !== 'word') return false;
    if (colonAfter(tokens, at) >= 0 || FIELD_WORDS.has(lower(token.text))) return true;
    if (token.text !== 'of') seen++;
  }
  return colonAfter(tokens, index) >= 0;
}

/** Whether a label starts at word `index`: one to three words that are a label ("Account Name"). */
function startsLabel(tokens: readonly Token[], index: number): boolean {
  const words = wordsFrom(tokens, index, 3);
  return words.some((_, end) => LABEL_WORDS.test(words.slice(0, end + 1).join(' ')));
}

/**
 * The parties after a label, from token `from`: every capitalised word to the end of the line
 * belongs to one, except where the span ends: at a label, a field word or a currency. Lowercase
 * words other than particles, and joiners, end a party, not the span.
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
    // Numbers and other data are skipped; a currency ends the span ("John Kamau KES 12,500,000").
    if (token?.kind !== 'word') continue;
    const word = token.text;
    if (CURRENCIES.has(lower(word))) break;
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
  // The party as the page writes it, offices aside: an organisation's name keeps every word.
  const named: string[] = [];
  for (const word of words) {
    if (ROLE_WORDS.has(lower(word))) {
      while (qualifiesOffice(named.at(-1))) named.pop();
      continue;
    }
    if (word.length <= MAX_WORD_LENGTH) named.push(word);
  }
  const kept = named.filter((word) => !NOT_NAMES.has(lower(word)));
  // Each part of a joined name on its own ("Mary-Jane"), so either is found bare.
  const names = kept
    .filter((word) => !isOrganisationWord(word))
    .flatMap((word) => [word, ...(/[-/]/u.test(word) ? word.split(/[-/]/u) : [])])
    .filter((word) => word.length >= 2)
    .map((value): DocumentIdentifier => ({ value, cls: 'PERSON' }));
  const organisation = named.join(' ');
  return isOrganisationWord(named.at(-1)) && organisation.length <= MAX_VALUE_LENGTH
    ? [{ value: organisation, cls: 'ORGANISATION' }, ...names]
    : names;
}

/**
 * Whether a name label at `index` is another field's name: "Name" after a word that names what it
 * is the name of ("Bank Name:", "Branch Name:", "Employer Name:").
 */
function namesAnotherField(tokens: readonly Token[], index: number, label: string): boolean {
  if (!/^names?$/iu.test(label)) return false;
  const before = tokenAt(tokens, index) - 1;
  const previous = tokens[before]?.kind === 'space' ? tokens[before - 1] : tokens[before];
  return previous?.kind === 'word' && NAMED_FIELDS.has(lower(previous.text));
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
const LABELLED_MEMBER_NUMBER = new RegExp(
  String.raw`${EDGE}(?i:(?:member(?:ship)?|payroll|staff|personal|employee|customer|policy|tsc)[ \t]+(?:no\.?|number)|nambari[ \t]+ya[ \t]+(?:uanachama|mwanachama|mshahara))[ \t]*(?:[:\-][ \t]*)?([A-Za-z0-9][A-Za-z0-9/-]{2,40})`,
  'gu',
);
const ORDINAL = /^\d+(?:st|nd|rd|th)$/iu;
/** A number a page labels as an account's: whatever its shape, an account number. */
const LABELLED_ACCOUNT_NUMBER = new RegExp(
  String.raw`${EDGE}(?i:account[ \t]+(?:no\.?|number)|a\/c[ \t]*(?:no\.?)?|nambari[ \t]+ya[ \t]+akaunti)[ \t]*(?:[:\-][ \t]*)?(\d[\d -]{2,30}\d)`,
  'gu',
);
/** List entries read under one label, at most. */
const MAX_ENTRIES = 20;
/** Marks that start a list entry: a bullet or dash, after which a name may follow. */
const BULLETS = new Set(['-', '*', '\u2022', '\u2013', '\u2014']);
/** Letters and roman numerals that number a list ("a)", "ii."). */
const LIST_LETTERS = /^(?:[a-z]|[ivx]{1,4})$/iu;

/** The token after a list entry's marker ("1.", "a)", "ii.", a dash or bullet), or 0 for none. */
function afterMarker(tokens: readonly Token[]): number {
  let at = 0;
  while (tokens[at]?.kind === 'space') at++;
  const marker = tokens[at];
  const next = tokens[at + 1];
  if (marker?.kind === 'other' && BULLETS.has(marker.text)) return at + 1;
  const numbered =
    (marker?.kind === 'number' && marker.text.length <= 2) ||
    (marker?.kind === 'word' && LIST_LETTERS.test(marker.text));
  if (numbered && next?.kind === 'other' && (next.text === '.' || next.text === ')')) return at + 2;
  return 0;
}

/**
 * Whether an unmarked line under a stand-alone label is one more entry: a few capitalised words
 * and particles, no field word, then nothing or a comma, dash or colon and an office ("Mary
 * Wanjiru, Secretary"). A marked line ("2. ...") always is.
 */
function readsAsName(tokens: readonly Token[]): boolean {
  const words: string[] = [];
  let at = 0;
  for (; at < tokens.length; at++) {
    const token = tokens[at];
    if (token?.kind === 'space') continue;
    if (token?.kind !== 'word') break;
    if (PARTICLES.has(token.text)) continue;
    if (!isCapitalised(token.text) || LABEL_WORDS.test(token.text)) return false;
    if (FIELD_WORDS.has(lower(token.text))) return false;
    words.push(token.text);
  }
  if (words.length === 0 || words.length > 6) return false;
  const rest = tokens.slice(at).filter((token) => token.kind !== 'space');
  if (rest.length === 0) return true;
  const [mark, ...office] = rest;
  const separates =
    mark?.kind === 'joiner' ||
    mark?.kind === 'colon' ||
    (mark?.kind === 'other' && BULLETS.has(mark.text));
  return (
    separates &&
    office.length > 0 &&
    office.every(
      (token) =>
        token.kind === 'word' && (ROLE_WORDS.has(lower(token.text)) || qualifiesOffice(token.text)),
    )
  );
}

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
    (current, shape) =>
      current.replace(shape, (match) => match.replace(/[^\r\n\v\f\u0085\u2028\u2029]/gu, ' ')),
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
    const labels = [...line.matchAll(LABEL), ...line.matchAll(OFFICE_LABEL)];
    for (const match of labels) {
      const end = match.index + match[0].length;
      if (!isLabel(line, match.index, end)) continue;
      if (namesAnotherField(tokensAt(row), match.index, match[0])) continue;
      let at = row;
      const from = tokenAt(tokensAt(row), end);
      const parties = labelParties(tokensAt(row), from);
      if (parties.length === 0) {
        if (!standsAlone(tokensAt(row), from)) continue;
        // The value is on a line below the label, after blank lines at most, and the lines after
        // it that list more parties, numbered, bulleted or a name each.
        at = nextLine(nameLines, row);
        if (at < 0) continue;
        add(labelParties(tokensAt(at), afterMarker(tokensAt(at))));
        // Further entries, across blank lines: every marked line, and an unmarked one that reads
        // as a name. An entry with other data on it is read all the same; only an unmarked line
        // that is not a name ends the list.
        for (let entries = 1; entries < MAX_ENTRIES; entries++) {
          const next = nextLine(nameLines, at);
          if (next < 0) break;
          const tokens = tokensAt(next);
          const from = afterMarker(tokens);
          if (from === 0 && !readsAsName(tokens)) break;
          add(labelParties(tokens, from));
          at = next;
        }
        continue;
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
    for (const match of original.matchAll(LABELLED_ACCOUNT_NUMBER)) {
      if (match[1]) found.push({ value: match[1], cls: 'ACCOUNT' });
    }
    for (const match of original.matchAll(LABELLED_MEMBER_NUMBER)) {
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
