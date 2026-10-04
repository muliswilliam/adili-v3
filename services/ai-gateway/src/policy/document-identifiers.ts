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
  // Not a member's deposits ("Member Deposits"); a member's number is read as a value, after
  // which a name may follow ("Member No. 3310 Mary Wanjiru").
  String.raw`members?(?![ \t]+deposits)(?:\s+name)?`,
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
  // Parties of a SACCO's letters, a will, a grant and an application.
  'parties',
  'beneficiar(?:y|ies)',
  'applicants?',
  'children',
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

/**
 * An identifier's shape: a regular expression, or a scan that `String.replace` runs as one
 * (minimisation's parcels).
 */
export type Shape =
  RegExp | { [Symbol.replace](text: string, replacer: (match: string) => string): string };

/** What a shape's characters are blanked to: a private-use mark that is no word. */
const BLANK = '\ue000';

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
  'kes',
  'ksh',
  'kshs',
  'sh',
  'shs',
  'usd',
  'eur',
  'gbp',
  'tsh',
  'tzs',
  'ush',
  'ugx',
]);

/** Words that join two parties, in any case: "and", "or", Swahili "na", "aka", "alias". */
const JOINER_WORDS = new Set(['and', 'or', 'and/or', 'na', 'pia', 'pamoja', 'aka', 'alias']);
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
  ...['holdings', 'enterprises', 'cooperative', 'trust', 'group', 'chama', 'traders', 'power'],
  ...['foods', 'industries', 'services', 'motors', 'investments', 'ventures', 'supplies'],
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
/** Words that end a field's label before its value ("ID No.", "Account Number"). */
const NUMBER_WORDS = ['no', 'nos', 'number', 'nambari', 'namba'];
/** Capitalised words no one is named ("Owner PIN", "Dear Sir", "the Late"). */
const NOT_NAMES = new Set([
  ...NUMBER_WORDS,
  ...['pin', 'id', 'kra', 'the', 'of', 'late', 'marehemu', 'sir', 'madam'],
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
  ...['status', 'tel', 'telephone', 'phone', 'mobile', 'email', 'address'],
  'designation',
  ...['department', 'employer', 'institution', 'account', 'loan', 'ref', 'reference', 'pin'],
  ...['id', 'signature', 'sahihi', 'tarehe', 'kiasi', 'salio', 'cheo', 'idara', 'simu'],
  ...['gender', 'nationality', 'occupation', 'grade', 'salary', 'pay', 'shares', 'value'],
  ...['purpose', 'parcel', 'village', 'ward', 'plot'],
  ...['bank', 'company', 'business', 'sacco', 'group', 'vehicle', 'description'],
  ...['manufacturer', 'registry', 'residence', 'constituency', 'sub-county', 'ministry'],
  ...['organisation', 'organization', 'ordinary', 'preference', 'redeemable', 'founder'],
  ...['facility', 'interest', 'rate', 'overdraft', 'deposits'],
]);
/** Field words that are also names: they end a span only before a value ("Ward 5"). */
const NAME_FIELDS = new Set(['ward', 'grade', 'village', 'section', 'plot', 'pay', 'term', 'rate']);
/** Field words that end a company's name, as company words do ("Sacco", "Business"). */
const ORGANISATION_FIELDS = new Set(['bank', 'company', 'business', 'sacco', 'group']);
/**
 * Words that start a field label of two words or more ("Account Type:", "Basic Salary:", "Date of
 * Registration:"): a span ends before them, as before a one-word one.
 */
const FIELD_LEADS = new Set([
  ...FIELD_WORDS,
  ...['registration', 'customer', 'kra', 'tax', 'postal', 'physical', 'basic', 'gross', 'net'],
  ...['job', 'total'],
  'nature',
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

/**
 * Places a line below a name may hold (a county or a large town), which the name does not wrap
 * onto: "John Kamau\nNakuru".
 */
const PLACES = new Set([
  ...COUNTIES.flatMap(({ name }) => name.toLowerCase().split(/[\s-]+/u)),
  ...['eldoret', 'thika', 'malindi', 'kitale', 'naivasha', 'nanyuki', 'ruiru', 'kitengela'],
  ...['kenya', 'uganda', 'tanzania', 'rwanda', 'nyali', 'westlands', 'kilimani'],
  ...['kileleshwa', 'lavington', 'parklands', 'runda', 'muthaiga', 'langata', 'gigiri'],
]);
/** A document's headings and vehicle makes, which a list's unmarked line may hold. */
const HEADING_WORDS = new Set([
  ...['assets', 'liabilities', 'security', 'offered', 'share', 'capital', 'schedule'],
  ...['registered', 'office', 'terms', 'conditions', 'particulars', 'details', 'summary'],
  ...['toyota', 'nissan', 'isuzu', 'mitsubishi', 'mazda', 'subaru', 'honda', 'mercedes'],
  ...['volkswagen', 'suzuki', 'land', 'county', 'collateral', 'vehicles', 'vehicle', 'motor'],
  ...['properties', 'property', 'shareholding', 'shareholdings', 'freehold', 'leasehold'],
  ...['absolute', 'residential', 'commercial', 'agricultural', 'industrial'],
]);
/**
 * Vehicle models, which are also surnames ("Prado", "Fielder"): an item when a list line starts
 * with one ("(a) Premio Year 2015"), a name after a name word ("(a) Ana Prado").
 */
const VEHICLE_MODELS = new Set([
  ...['premio', 'axio', 'fielder', 'vitz', 'probox', 'demio', 'allion', 'corolla', 'hilux'],
  ...['prado', 'belta', 'passo', 'ractis', 'sienta', 'wingroad', 'tiida'],
]);
/** Words that, before a colon, end a name's span: another field, an organisation, place, office. */
const BOUNDARY_WORDS: ReadonlySet<string> = new Set([
  ...FIELD_LEADS,
  ...ORGANISATION_WORDS,
  ...PLACES,
  ...ROLE_WORDS,
]);
/**
 * Words known to be no one's name, or common words that are also names: a name a page gives that
 * is one of them is matched only as written, capitalised or in capitals, so one false hit does
 * not hide the word everywhere ("Group", "Branch", "Nakuru", "Grace"). Any other name is matched
 * in every case, as privacy asks.
 */
const WRITTEN_ONLY: ReadonlySet<string> = new Set([
  ...COMMON_WORDS,
  ...BOUNDARY_WORDS,
  ...ROLE_QUALIFIERS,
  ...HEADING_WORDS,
  ...CURRENCIES,
]);

/** Words of an address that are also names ("Peter Box"): matched only as written. */
const ADDRESS_WORDS: ReadonlySet<string> = new Set(['box']);

/**
 * How a name word the page gives recurs: `any` case; `written`, as written, capitalised or in
 * capitals (a common word that is also a name: "Grace"); or `exact`, only as written (a word known
 * to be no one's name, which one false hit must not hide elsewhere: "Branch", "Group", "Nakuru").
 */
export function recurrenceOf(word: string): 'any' | 'written' | 'exact' {
  const text = word.toLowerCase();
  if (COMMON_WORDS.has(text)) return 'written';
  return WRITTEN_ONLY.has(text) || ADDRESS_WORDS.has(text) ? 'exact' : 'any';
}

/**
 * Whether a name word found again, with `rest` the text after it, is an address's word
 * instead: "Box" before a number ("Postal: Box 99") is not the name "Box".
 */
export function addressesAt(word: string, rest: string): boolean {
  return ADDRESS_WORDS.has(word.toLowerCase()) && ADDRESS_NUMBER.test(rest);
}

/** A number after spaces, as an address's box number follows "Box". */
const ADDRESS_NUMBER = /^[ \t]*\p{N}/u;

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
 * Whether a value follows the word at `index` (past spaces): a number, a token, a currency or a
 * word known to be no one's name ("Gender Male", "ID 12345678"), not another name word.
 */
function valueAfter(tokens: readonly Token[], index: number): boolean {
  let at = index + 1;
  while (tokens[at]?.kind === 'space') at++;
  const next = tokens[at];
  if (next?.kind === 'number') return true;
  if (next?.kind === 'other' && (next.text === BLANK || next.text.startsWith('[['))) return true;
  return (
    next?.kind === 'word' &&
    (CURRENCIES.has(lower(next.text)) || COMMON_WORDS.has(lower(next.text)))
  );
}

/**
 * Whether the word at `index` labels another field, which ends a name's span:
 * - a field, organisation, place or office word before a colon ("Make:", "Bank:", "Nakuru:");
 * - a field word before a value ("Gender Male", "ID 12345678"), but not before more name words
 *   ("John Kamau Ward Otieno": Ward is a name there);
 * - a field label's first word before one or two more and a colon ("Account Type:", "Nature of
 *   Title:").
 * Nothing else does, not even a colon after a name ("John Kamau: Chairman"): when in doubt, a word
 * is a name.
 */
function labelsAField(tokens: readonly Token[], index: number): boolean {
  const word = tokens[index];
  if (word?.kind !== 'word') return false;
  const text = lower(word.text);
  if (colonAfter(tokens, index) >= 0) return BOUNDARY_WORDS.has(text);
  if (FIELD_WORDS.has(text)) return fieldWordEnds(tokens, index);
  if (!FIELD_LEADS.has(text)) return false;
  // The field label's next words, past spaces and an "of", up to its colon or value.
  for (let at = index + 1, seen = 0; at < tokens.length && seen < 2; at++) {
    const token = tokens[at];
    if (token?.kind === 'space') continue;
    if (token?.kind !== 'word') return false;
    if (colonAfter(tokens, at) >= 0) return true;
    if (FIELD_WORDS.has(lower(token.text))) return fieldWordEnds(tokens, at);
    if (token.text !== 'of') seen++;
  }
  return false;
}

/**
 * Whether a field word without a colon ends a span. Most do ("Make Toyota", "County Kiambu",
 * "Employer Kenya Power"). One that is also a name ("Ward", "Grade", "Village") ends it only
 * before a value, so "John Kamau Ward Otieno" keeps Ward Otieno. One that ends a company's name
 * ("Bank", "Group") ends it unless a company word follows or nothing does ("Pwani Commercial
 * Bank Limited", "Upendo Women Group").
 */
function fieldWordEnds(tokens: readonly Token[], index: number): boolean {
  const word = tokens[index];
  if (word?.kind !== 'word') return false;
  const text = lower(word.text);
  if (NAME_FIELDS.has(text)) return valueAfter(tokens, index);
  if (!ORGANISATION_WORDS.has(text) && !ORGANISATION_FIELDS.has(text)) return true;
  let at = index + 1;
  while (tokens[at]?.kind === 'space') at++;
  const next = tokens[at];
  return next?.kind === 'word' && !isOrganisationWord(next.text);
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
    // A shape (an ID, phone, email or address) after a name, and its address's tail, end the
    // party. The span goes on at a joiner ("John Kamau ID 12345678 of Nakuru and Mary Wanjiru")
    // or a name ("John Kamau 0712345678 Mary Wanjiru"), and ends at anything else: a field's
    // value or an item ("John Kamau ID 12345678 Toyota Premio", "... Equity Bank"). A shape
    // before the name is skipped ("Proprietor: ID 12345678 John Kamau").
    if (token?.kind === 'other' && token.text === BLANK) {
      if (words === 0) continue;
      const next = partyAfterValue(tokens, at);
      if (next < 0) break;
      nextParty();
      at = next - 1;
      continue;
    }
    // Numbers and other data are skipped; a currency ends the span ("John Kamau KES 12,500,000").
    if (token?.kind !== 'word') continue;
    const word = token.text;
    // A label that prose follows names no one ("Members of the Board").
    if (
      words === 0 &&
      !isCapitalised(word) &&
      !PARTICLES.has(word) &&
      !FILLER_WORDS.has(lower(word))
    )
      break;
    // A place after "of" is where a party lives, no name ("John Kamau of Nakuru").
    if (lower(word) === 'of') {
      nextParty();
      at = addressTail(tokens, at) - 1;
      continue;
    }
    if (CURRENCIES.has(lower(word))) break;
    if (!isCapitalised(word)) {
      if (!PARTICLES.has(word)) nextParty();
      continue;
    }
    // A field whose value is a shape or a number ends a party as a shape does ("John Kamau KRA
    // PIN A123456789Z and Mary Wanjiru", "Mary Wanjiru, Member No. 3310, and Peter Otieno").
    const opening = fieldValueAt(tokens, at, words === 0);
    const value = opening > 0 ? opening : fieldValueAt(tokens, at);
    if (value > 0) {
      // A field before the name is skipped ("Proprietor: ID 12345678 John Kamau"); a member's
      // number the span opens on is followed by a name or ends it ("Member No. 3310 Mary
      // Wanjiru", not "... Stima Sacco").
      const numberFirst = words === 0 && LABEL_TAILS.has(lower(word));
      const next =
        words === 0 && !numberFirst ? value : partyAfterValue(tokens, value, numberFirst);
      if (next < 0) break;
      nextParty();
      at = next - 1;
      continue;
    }
    if (startsLabel(tokens, at) || labelsAField(tokens, at) || addressStarts(tokens, at)) break;
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
 * Whether a person's name starts at `at`: capitalised name words and particles, none a known word
 * (a field, heading, office, vehicle model or currency), not an organisation's, and not places
 * alone ("Mary Wanjiru", "Kericho Langat"; not "Toyota Premio", "Freehold", "Equity Bank",
 * "Nairobi"). An address's word that is no surname makes the run an address ("Runda Estate",
 * "Kakuzi Estate", "Kileleshwa Road"); one that is a surname does only after places alone
 * ("Westlands Park", not "Mary Park", "Peter Close"). When `strict` (after a member's number,
 * where a statement's fields follow), the run is no name either before a colon, a currency, a
 * month or an uncapitalised word, or when one word is all it holds before a field word
 * ("Statement Period:", "Monthly Contribution KES 5,000", "Approved by the Board", "Opening
 * Balance 20,000").
 */
function nameRunAt(tokens: readonly Token[], at: number, strict = false): boolean {
  let names = 0;
  let places = 0;
  let next = at;
  // What ends the run: the token after it, and whether it is a field word.
  let field = false;
  for (; next < tokens.length; next++) {
    const token = tokens[next];
    if (token?.kind === 'space') continue;
    if (token?.kind !== 'word') break;
    if (PARTICLES.has(token.text) && names > 0) continue;
    const word = lower(token.text);
    if (isOrganisationWord(word)) return false;
    if (!isCapitalised(token.text)) break;
    if (strict && MONTHS.has(word)) return false;
    // A field's label ends the name ("Peter Otieno Staff No. 12").
    if (CODE_LEADS.has(word) || LABEL_TAILS.has(word)) break;
    if (ADDRESS_WORDS_NO_NAME.has(word)) return false;
    if (ADDRESS_TAIL_WORDS.has(word) && names === places) return false;
    if (PLACES.has(word)) {
      places++;
      names++;
      continue;
    }
    // A common word that is also a name is one here ("Grace Njeri").
    const common = COMMON_WORDS.has(word) && !FIELD_LEADS.has(word);
    if ((WRITTEN_ONLY.has(word) && !common) || VEHICLE_MODELS.has(word) || FIELD_WORDS.has(word)) {
      field = FIELD_LEADS.has(word) || CURRENCIES.has(word);
      break;
    }
    if (startsLabel(tokens, next) || labelsAField(tokens, next)) break;
    names++;
  }
  if (names <= places) return false;
  if (!strict) return true;
  const after = tokens[next];
  const prose =
    after?.kind === 'colon' ||
    (after?.kind === 'word' && !isCapitalised(after.text) && !JOINER_WORDS.has(after.text));
  return (
    !prose &&
    !(field && names === 1) &&
    !(after?.kind === 'word' && CURRENCIES.has(lower(after.text)))
  );
}

/** Months, which a statement's dates hold ("Jan 2023", "31 December 2023"). */
const MONTHS: ReadonlySet<string> = new Set([
  ...['jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june'],
  ...['jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov'],
  ...['november', 'dec', 'december'],
]);

/** Words a field's label may hold after its field words ("ID No.", "Account Number"). */
const LABEL_TAILS: ReadonlySet<string> = new Set(NUMBER_WORDS);

/** Words of an address that are no one's surname ("Runda Estate", "Westlands Road"). */
const ADDRESS_WORDS_NO_NAME: ReadonlySet<string> = new Set([
  ...['road', 'rd', 'street', 'avenue', 'highway', 'town', 'city', 'estate', 'building'],
  ...['floor', 'county', 'centre', 'apartments', 'apartment', 'gardens', 'flats'],
]);
/** Words of an address's tail after its box or before its town ("Westlands Road", "Plot No. 45"). */
const ADDRESS_TAIL_WORDS: ReadonlySet<string> = new Set([
  ...ADDRESS_WORDS_NO_NAME,
  // Address words that are also surnames ("Mary Park", "Peter Close").
  ...['lane', 'drive', 'close', 'way', 'house', 'court', 'heights', 'park'],
  ...['of', 'box', 'plot'],
  ...NUMBER_WORDS,
]);

/**
 * The first token from `at` past an address's tail: shapes, numbers, marks other than joiners,
 * places and address words ("of Nakuru", "Nakuru Town", "Westlands Road", "Plot No. 45"). After a
 * shape, the tail is the address's, not a party.
 */
function addressTail(tokens: readonly Token[], at: number): number {
  let next = at;
  for (; next < tokens.length; next++) {
    const token = tokens[next];
    if (token?.kind === 'joiner') break;
    if (token?.kind !== 'word') continue;
    const word = lower(token.text);
    if (!PLACES.has(word) && !ADDRESS_TAIL_WORDS.has(word)) break;
  }
  return next;
}

/** Words that start a code's label ("Member No.", "Payroll Number"), before a number word. */
const CODE_LEADS = new Set(['member', 'membership', 'payroll', 'staff', 'policy', 'employee']);

/**
 * Where a field's value starts after its label at `at`: the label's field words (and number
 * words), spaces, dots and colons, then a blanked shape ("KRA PIN A123...", "ID No. 12345678"),
 * or a number after a number word ("Member No. 3310", "Account Number 0123456789"); -1 for none.
 * When `opening`, the label may be the number word alone, as a span opens on it after a label
 * ("Member No. 3310": the span after "Member" is "No. 3310").
 */
function fieldValueAt(tokens: readonly Token[], at: number, opening = false): number {
  let next = at;
  let fields = 0;
  let codes = 0;
  let numbered = false;
  for (; next < tokens.length; next++) {
    const token = tokens[next];
    if (token?.kind === 'space' || token?.kind === 'colon' || isMark(token, '.')) continue;
    if (token?.kind !== 'word') break;
    const word = lower(token.text);
    if (FIELD_LEADS.has(word)) fields++;
    else if (CODE_LEADS.has(word) && fields === 0 && !numbered) codes++;
    else if ((fields + codes > 0 || opening) && LABEL_TAILS.has(word)) numbered = true;
    else break;
  }
  const value = tokens[next];
  const shaped = isMark(value, BLANK) && (fields > 0 || numbered);
  const number = value?.kind === 'number' && numbered;
  return shaped || number ? next : -1;
}

/**
 * Where the span goes on after a value at `at` (a shape, or a field's number) that follows a name:
 * past the value, its address's tail, joiners and any more fields and values, at a person's name
 * ("... ID 12345678 of Nakuru and Mary Wanjiru", "... 0712345678 Mary Wanjiru"); -1 when an item,
 * an organisation or a place follows instead ("... ID 12345678 Toyota Premio", "... Equity Bank",
 * "... ID 12345678, Runda Estate, Nairobi").
 */
function partyAfterValue(tokens: readonly Token[], at: number, strict = false): number {
  let next = addressTail(tokens, at);
  for (;;) {
    const value = fieldValueAt(tokens, next);
    const after = tokens[next];
    const joins =
      after?.kind === 'joiner' || (after?.kind === 'word' && JOINER_WORDS.has(lower(after.text)));
    if (value > 0) next = addressTail(tokens, value);
    else if (joins) next = pastFiller(tokens, nextToken(tokens, next));
    else break;
  }
  return nameRunAt(tokens, next, strict) ? next : -1;
}

/** Words between a joiner and the name it joins ("and the Late Mary", "and his wife Mary"). */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  ...['the', 'late', 'his', 'her', 'their', 'wife', 'husband', 'spouse', 'son', 'daughter'],
  ...['marehemu', 'mke', 'mume', 'wake', 'mr', 'mrs', 'ms', 'miss', 'dr'],
]);

/** The first token from `at` past filler words, their dots and spaces. */
function pastFiller(tokens: readonly Token[], at: number): number {
  let next = at;
  for (; next < tokens.length; next++) {
    const token = tokens[next];
    if (token?.kind === 'space' || isMark(token, '.')) continue;
    if (token?.kind !== 'word' || !FILLER_WORDS.has(lower(token.text))) break;
  }
  return next;
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
 * Whether a line continues a name wrapped from the line above: one to three capitalised name
 * words and nothing else, none a label, field, organisation, place, office, heading or common
 * word ("John\nKamau Mwangi"; not "Assets", "Toyota Premio", "Kiambu County Land").
 */
function wrapsName(tokens: readonly Token[]): boolean {
  const words = tokens.filter((token) => token.kind === 'word');
  return (
    words.length > 0 &&
    words.length <= 3 &&
    tokens.every((token) => token.kind === 'word' || token.kind === 'space') &&
    words.every(
      ({ text }) =>
        (isCapitalised(text) || PARTICLES.has(text)) &&
        !LABEL_WORDS.test(text) &&
        !WRITTEN_ONLY.has(lower(text)),
    )
  );
}

/** A list entry's marker: its kind, the number it gives, how far it is indented, and where the entry starts. */
interface Marker {
  kind: 'digit' | 'letter' | 'roman' | 'bullet';
  value: number;
  indent: number;
  from: number;
}

/** A roman numeral of two letters or more, up to 39 ("ii", "iv", "xii"); "i" alone is a letter. */
const ROMAN = /^(?=[ivx]{2,})x{0,3}(?:ix|iv|v?i{0,3})$/iu;
const ROMAN_DIGITS: Readonly<Partial<Record<string, number>>> = { i: 1, v: 5, x: 10 };
/** A roman numeral's value ("iv" is 4); its letters are i, v and x. */
function romanValue(text: string): number {
  const digits = Array.from(text.toLowerCase(), (char) => ROMAN_DIGITS[char] ?? 0);
  return digits.reduce(
    (sum, value, index) => sum + (value < (digits[index + 1] ?? 0) ? -value : value),
    0,
  );
}

/**
 * A line's list marker ("1.", "a)", "(ii)", "[1]", "1 ", a dash or bullet), or null. A capital
 * and a dot before a capitalised word is an initial, not a marker ("J. Kamau").
 */
function markerOf(tokens: readonly Token[]): Marker | null {
  let at = 0;
  let indent = 0;
  while (tokens[at]?.kind === 'space') {
    indent += (tokens[at] as { width: number }).width;
    at++;
  }
  const isOther = (token: Token | undefined, ...texts: string[]) =>
    token?.kind === 'other' && texts.includes(token.text);
  const numbering = (token: Token | undefined): Omit<Marker, 'indent' | 'from'> | null => {
    if (token?.kind === 'number' && token.text.length <= 2) {
      return { kind: 'digit', value: Number(token.text) };
    }
    if (token?.kind !== 'word') return null;
    if (ROMAN.test(token.text)) return { kind: 'roman', value: romanValue(token.text) };
    if (LIST_LETTERS.test(token.text)) {
      return { kind: 'letter', value: token.text.toLowerCase().charCodeAt(0) - 96 };
    }
    return null;
  };
  const [first, second, third] = [tokens[at], tokens[at + 1], tokens[at + 2]];
  if (first?.kind === 'other' && BULLETS.has(first.text)) {
    return { kind: 'bullet', value: 0, indent, from: at + 1 };
  }
  // "(a)", "(1)", "(ii)", "[1]".
  const wrapped = isOther(first, '(', '[') && isOther(third, ')', ']') ? numbering(second) : null;
  if (wrapped) return { ...wrapped, indent, from: at + 3 };
  // "1.", "a)", "ii.": not an initial ("J. Kamau").
  const plain = isOther(second, '.', ')') ? numbering(first) : null;
  if (plain) {
    const initial =
      plain.kind === 'letter' &&
      first?.kind === 'word' &&
      isCapitalised(first.text) &&
      isOther(second, '.') &&
      tokens[at + 2]?.kind === 'space' &&
      tokens[at + 3]?.kind === 'word' &&
      isCapitalised((tokens[at + 3] as { text: string }).text);
    if (!initial) return { ...plain, indent, from: at + 2 };
  }
  // "1 John Kamau": a bare number, a space and a capitalised word.
  if (first?.kind === 'number' && first.text.length <= 2 && second?.kind === 'space') {
    const word = tokens[at + 2];
    if (word?.kind === 'word' && isCapitalised(word.text)) {
      return { kind: 'digit', value: Number(first.text), indent, from: at + 2 };
    }
  }
  return null;
}

/**
 * Field words that name an item, not a person, after one word on a list line ("Ordinary Shares",
 * "Freehold Tenure", "Residential Plot", "Current Account"). A company word after a name makes an
 * organisation of it on its own ("Equity Bank"), so it is not here.
 */
const ITEM_FIELDS = new Set(['shares', 'tenure', 'plot', 'account']);

/** The token before `at`, past spaces. */
function tokenBefore(
  tokens: readonly Token[],
  at: number,
): { token: Token | undefined; at: number } {
  let before = at - 1;
  while (tokens[before]?.kind === 'space') before--;
  return { token: tokens[before], at: before };
}

const isWordToken = (token: Token | undefined, text: string) =>
  token?.kind === 'word' && lower(token.text) === text;
const isMark = (token: Token | undefined, text: string) =>
  token?.kind === 'other' && token.text === text;

/** The index of the first token after `at` that is not a space. */
function nextToken(tokens: readonly Token[], at: number): number {
  let next = at + 1;
  while (tokens[next]?.kind === 'space') next++;
  return next;
}

/**
 * Whether a postal address starts at the word at `at`: "Box" before a number ("Box 123"), "PO Box",
 * "P.O. Box", "P.O Box", "Post Office Box", or "Box" after one of those. A name's span ends there.
 */
function addressStarts(tokens: readonly Token[], at: number): boolean {
  const token = tokens[at];
  if (token?.kind !== 'word') return false;
  const word = lower(token.text);
  // The index of "Box" after the address's opening words, or -1.
  let box = -1;
  if (word === 'po') box = nextToken(tokens, at);
  if (word === 'post' && isWordToken(tokens[nextToken(tokens, at)], 'office')) {
    box = nextToken(tokens, nextToken(tokens, at));
  }
  if (word === 'p' && isMark(tokens[at + 1], '.') && isWordToken(tokens[at + 2], 'o')) {
    box = nextToken(tokens, isMark(tokens[at + 3], '.') ? at + 3 : at + 2);
  }
  if (box >= 0) return isWordToken(tokens[box], 'box');
  if (word !== 'box') return false;
  if (tokens[nextToken(tokens, at)]?.kind === 'number') return true;
  // "Box" after "PO", "P.O.", "P.O" or "Post Office".
  const one = tokenBefore(tokens, at);
  if (isWordToken(one.token, 'po')) return true;
  if (isWordToken(one.token, 'office')) {
    return isWordToken(tokenBefore(tokens, one.at).token, 'post');
  }
  const o = isMark(one.token, '.') ? one.at - 1 : one.at;
  return (
    isWordToken(tokens[o], 'o') && isMark(tokens[o - 1], '.') && isWordToken(tokens[o - 2], 'p')
  );
}

/**
 * How a list line reads, from token `from` (past its marker), on its leading words: one to six
 * capitalised name words, particles and initials ("J."), after any office ("Secretary Mary
 * Wanjiru"), none a place, heading or common word, up to the first field word, currency,
 * uncapitalised word, number, joiner, dash or other mark ("John Kamau ID 12345678", "Mary Wanjiru
 * - 40%"). A company word after them makes the line an organisation ("Equity Bank"), not a name.
 * One word is an item, not a name, only before a field word that names an item ("Ordinary Shares",
 * "Freehold Tenure"); before anything else it is a name ("Achieng 40%", "Achieng KES 500",
 * "Otieno Year 2015", "Achieng Box 12").
 * `name` when nothing follows the name; `name-office` when a comma, dash or colon and only offices
 * or field words follow ("Mary Wanjiru, Secretary"); `name-led` when anything else follows;
 * `other` when the leading words are not a name. `names` are the name's words.
 */
function listLine(tokens: readonly Token[], from: number): ListLine {
  const other: ListLine = { reading: 'other', names: [] };
  const names: string[] = [];
  // Whether the name stops at a field word that names an item.
  let atItemField = false;
  let at = from;
  for (; at < tokens.length; at++) {
    const token = tokens[at];
    if (token?.kind === 'space') continue;
    if (token?.kind === 'other' && token.text === '.' && names.length > 0) continue;
    if (token?.kind !== 'word') break;
    if (PARTICLES.has(token.text)) continue;
    const word = lower(token.text);
    // An office before the name, wherever the list puts it ("Chairman John Kamau").
    if (names.length === 0 && (ROLE_WORDS.has(word) || qualifiesOffice(token.text))) continue;
    if (names.length > 0 && isOrganisationWord(word)) return other;
    if (FIELD_WORDS.has(word) || CURRENCIES.has(word) || addressStarts(tokens, at)) {
      atItemField = ITEM_FIELDS.has(word);
      break;
    }
    // A word after the name ends it ("Peter Otieno born 1990").
    if (!isCapitalised(token.text) && names.length > 0) break;
    // A joined word is no name when a part of it is not ("Freehold/Leasehold").
    const known =
      word.split(/[-/]/u).some((part) => WRITTEN_ONLY.has(part)) ||
      (names.length === 0 && VEHICLE_MODELS.has(word));
    if (!isCapitalised(token.text) || known) return other;
    names.push(token.text);
  }
  if (names.length === 0 || names.length > 6) return other;
  if (names.length === 1 && atItemField) return other;
  const rest = tokens.slice(at).filter((token) => token.kind !== 'space');
  if (rest.length === 0) return { reading: 'name', names };
  const [mark, ...after] = rest;
  const separates =
    mark?.kind === 'joiner' ||
    mark?.kind === 'colon' ||
    (mark?.kind === 'other' && BULLETS.has(mark.text));
  const offices =
    after.length > 0 &&
    after.every(
      (token) =>
        token.kind === 'word' &&
        (ROLE_WORDS.has(lower(token.text)) ||
          qualifiesOffice(token.text) ||
          FIELD_WORDS.has(lower(token.text))),
    );
  return { reading: separates && offices ? 'name-office' : 'name-led', names };
}

/** How a list line reads, and the words of the name it leads with. */
interface ListLine {
  reading: 'name' | 'name-office' | 'name-led' | 'other';
  names: string[];
}

/**
 * Whether a list line reads as a name. A marked line is decided on its leading words; an unmarked
 * one must be a name alone or a name and an office, so a sentence that starts with a name is not
 * read as an entry.
 */
function readsAsName({ reading }: ListLine, marker: Marker | null): boolean {
  return marker ? reading !== 'other' : reading === 'name' || reading === 'name-office';
}

/** Lines past an unmarked one that the next entry may come after: a heading and its fields. */
const ENTRY_LOOKAHEAD = 5;

/**
 * The parties a list under a stand-alone label holds, from line `first`. The list's level is its
 * first marker's kind and indent. Every entry at that level is read with a label's span rules,
 * whatever data it holds. The list goes on:
 * - at a marked line of the level, unless its numbering starts again or repeats and it does not
 *   read as a name;
 * - at a marked line of another kind or indent (a sub-list: "(a) Toyota Premio"), read only if its
 *   leading words read as a name, and then only those ("(a) Peter Otieno ID 12345678");
 * - at an unmarked line before the level's next number (within a few lines), read only if it is a
 *   wrapped name: a heading and its fields are skipped;
 * - at an unmarked line straight below, when it is a name wrapped from the entry above, a name and
 *   an office, or a name in a list whose first entry is unmarked too.
 * After a blank line, a line must read as a name.
 */
function listParties(
  nameLines: readonly string[],
  tokensAt: (row: number) => Token[],
  first: number,
): string[][] {
  const parties: string[][] = [];
  // The first marker within a few lines after `row` that `wanted` accepts (any, by default).
  const markerAhead = (
    row: number,
    read: (at: number) => Marker | null,
    wanted: (marker: Marker) => boolean = () => true,
  ) => {
    for (let at = row + 1; at < nameLines.length && at <= row + ENTRY_LOOKAHEAD; at++) {
      const marker = read(at);
      if (marker && wanted(marker)) return marker;
    }
    return null;
  };
  // A line's marker; "i." is roman, not a letter, when the next marked line is "ii.".
  const markerAt = (row: number): Marker | null => {
    const marker = markerOf(tokensAt(row));
    if (marker?.kind !== 'letter' || marker.value !== 9) return marker;
    const next = markerAhead(row, (at) => markerOf(tokensAt(at)));
    const roman = next?.kind === 'roman' && next.value === 2 && next.indent === marker.indent;
    return roman ? { ...marker, kind: 'roman', value: 1 } : marker;
  };
  const firstMarker = markerAt(first);
  parties.push(...labelParties(tokensAt(first), firstMarker?.from ?? 0));
  let level = firstMarker?.kind === 'bullet' ? null : firstMarker;
  const atLevel = (marker: Marker | null) =>
    marker !== null &&
    level !== null &&
    marker.kind === level.kind &&
    marker.indent === level.indent;
  // Whether the level's next number comes within a few lines after `row`.
  const nextNumberAhead = (row: number) =>
    markerAhead(row, markerAt, atLevel)?.value === (level?.value ?? 0) + 1;
  let at = first;
  for (let entries = 1; entries < MAX_ENTRIES; entries++) {
    const next = nextLine(nameLines, at);
    if (next < 0) break;
    const tokens = tokensAt(next);
    const marker = markerAt(next);
    const line = listLine(tokens, marker?.from ?? 0);
    const name = readsAsName(line, marker);
    if (next > at + 1 && !name) break;
    at = next;
    if (marker && (level === null || atLevel(marker))) {
      if (level !== null && marker.value <= level.value && !name) break;
      parties.push(...labelParties(tokens, marker.from));
      if (marker.kind !== 'bullet') level = marker;
      continue;
    }
    if (marker) {
      // A sub-list's line: only the name it leads with ("(a) Peter Otieno - Son", not "Son").
      if (name) parties.push(line.names);
      continue;
    }
    if (nextNumberAhead(next)) {
      // A line before the next entry: read only a wrapped name.
      if (wrapsName(tokens)) parties.push(...labelParties(tokens, 0));
      continue;
    }
    const wraps = wrapsFrom(tokensAt(next - 1), nameLines[next - 1] ?? '') && wrapsName(tokens);
    const plainList = firstMarker === null && name;
    if (!wraps && !plainList && line.reading !== 'name-office') break;
    parties.push(...labelParties(tokens, 0));
  }
  return parties;
}

/**
 * Whether a list entry's line may wrap onto the next: it ends on a name word, and the name is a
 * single word or the line is long, as a line the page's width broke is ("1. John\nKamau Mwangi";
 * not "1. John Kamau\nCollateral").
 */
function wrapsFrom(tokens: readonly Token[], line: string): boolean {
  if (!endsWithName(tokens)) return false;
  const words = tokens.filter((token) => token.kind === 'word').length;
  return words === 1 || line.trim().length >= WRAPPED_LINE_LENGTH;
}

/** A line at least this long may have been broken by the page's width. */
const WRAPPED_LINE_LENGTH = 40;

/** Whether a line's last word, past spaces, is a capitalised name word: a name may wrap after it. */
function endsWithName(tokens: readonly Token[]): boolean {
  for (let at = tokens.length - 1; at >= 0; at--) {
    const token = tokens[at];
    if (token?.kind === 'space') continue;
    return (
      token?.kind === 'word' && isCapitalised(token.text) && !WRITTEN_ONLY.has(lower(token.text))
    );
  }
  return false;
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
/** A single letter that numbers a list ("a)", "(b)"); roman numerals are `ROMAN`. */
const LIST_LETTERS = /^[a-z]$/iu;

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
  shapes: readonly Shape[] = [],
): DocumentIdentifier[] {
  const found: DocumentIdentifier[] = [];
  // Each character of a shape becomes a private-use mark: a value, no name ("Tel 0712 ..."). The
  // mark already in a text layer is a space.
  const blanked = shapes.reduce(
    (current, shape) =>
      current.replace(shape, (match) => match.replace(/[^\r\n\v\f\u0085\u2028\u2029]/gu, BLANK)),
    text.replaceAll(BLANK, ' '),
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
    // A label and an office at the same place ("Director:") are read once.
    const seen = new Set<number>();
    const labels = [...line.matchAll(LABEL), ...line.matchAll(OFFICE_LABEL)].filter((match) => {
      if (seen.has(match.index)) return false;
      seen.add(match.index);
      return true;
    });
    for (const match of labels) {
      const end = match.index + match[0].length;
      if (!isLabel(line, match.index, end)) continue;
      if (namesAnotherField(tokensAt(row), match.index, match[0])) continue;
      let at = row;
      const from = tokenAt(tokensAt(row), end);
      const parties = labelParties(tokensAt(row), from);
      if (parties.length === 0) {
        if (!standsAlone(tokensAt(row), from)) continue;
        // The value is on a line below the label, after blank lines at most: a list of parties.
        at = nextLine(nameLines, row);
        if (at < 0) continue;
        add(listParties(nameLines, tokensAt, at));
        continue;
      }
      add(parties);
      // A name may wrap onto the next line; an office or company it ends in may not.
      const tail = parties.at(-1) ?? [];
      const wraps = !tail.some((word) => ROLE_WORDS.has(lower(word)) || isOrganisationWord(word));
      if (parties.length > 0 && wraps && wrapsName(tokensAt(at + 1))) {
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
