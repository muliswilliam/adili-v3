/**
 * The identifiers a document's text layer gives away by what introduces them, for minimisation
 * (spec 05b). A text layer has no fields to say what is a name, so this reads it as a page reads:
 * a label ("Proprietor:", "Guarantor:", "Jina:"), a title ("Mr.", "Rev.", "Bwana"), a salutation
 * ("Dear", "Mpendwa", "Ndugu") or a formula ("certify that", "Imesainiwa na") introduces the
 * parties after it. Each party is a person, word by word, or, when its name ends in a company
 * word, an organisation, whose other capitalised words are names too. Labelled member numbers and
 * line addresses are found as well.
 *
 * When in doubt a word is a name: over-matching only hides a word from the model, since every
 * token is restored, while a missed name leaves the platform. What this cannot see (a name with
 * no introducer, a lowercase name, a table's header row) is #504.
 */

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
/**
 * What introduces parties. Labels and formulas may take a colon or dash; a title is followed by a
 * dot or a space ("Mr.John", "Rev. Peter"); a salutation by a space.
 */
const INTRODUCERS: readonly RegExp[] = [
  new RegExp(`${EDGE}(?i:${NAME_LABELS.join('|')})${AFTER_WORD}[ \\t]*[:\\-]?`, 'gu'),
  new RegExp(`${EDGE}(?i:${TITLES.join('|')})(?:\\.[ \\t]*|[ \\t]+)`, 'gu'),
  new RegExp(`${EDGE}(?i:dear|mpendwa|ndugu|certify\\s+that|imesainiwa\\s+na)[ \\t]*[:\\-]?`, 'gu'),
];
/** A whole word that is a label: where a party's span ends ("John Kamau Guarantor: ..."). */
const LABEL_WORD = new RegExp(`^(?i:${NAME_LABELS.join('|')})$`, 'u');

/** A capitalised word as a page writes a name: WANJIRU, Akinyi, Ndung’u, O'Brien, JK. */
const NAME_WORD = /\p{Lu}[\p{L}'’.-]*/uy;
/**
 * What joins two parties: punctuation (`,` `;` `/` `&`), and words in English or Swahili, longest
 * first ("na pia" before "na").
 */
const JOINER =
  /(?:[,;&]|c\/o|w\/o|s\/o|d\/o|t\/a|\/|(?i:pamoja\s+na|na\s+pia|a\.k\.a\.?|aka|alias|and|or|na)(?![\p{L}]))/uy;
/** Lowercase words a party's span may hold that name no one ("the late John Kamau"). */
const FILLER = /(?i:the|late|marehemu|of)(?![\p{L}])/uy;
/** One space between words; two, a tab or a line break end the span. */
const GAP = / (?! )/uy;
/** After an introducer: spaces, then any number of line breaks and blank lines. */
const LEAD = /[ \t]*(?:\r?\n[ \t]*)*/uy;
/** A line that holds only capitalised words continues the party above it ("John Kamau\nMwangi"). */
const CONTINUATION =
  /\r?\n[ \t]*(\p{Lu}[\p{L}'’.-]*(?: \p{Lu}[\p{L}'’.-]*){0,4})[ \t]*(?=\r?\n|$)/uy;
/** Words in a span, at most: a party's name, its office and a few joint parties. */
const MAX_WORDS = 20;

/** Words a company or society's name ends in: "Tumaini Fresh Produce Limited", "Upendo Group". */
const ORGANISATION_WORDS = new Set([
  ...['limited', 'ltd', 'ltd.', 'plc', 'company', 'co.', 'bank', 'sacco', 'society'],
  ...['holdings', 'enterprises', 'cooperative', 'trust', 'group', 'chama', 'traders'],
]);
/** Offices a name sits next to ("Director Peter Kamau", "Kevin Odera Sacco Secretary"). */
const ROLE_WORDS = new Set([
  ...['secretary', 'treasurer', 'chairperson', 'chairman', 'chairwoman', 'chair', 'manager'],
  ...['officer', 'director', 'accountant', 'clerk', 'registrar', 'advocate', 'trustee'],
  ...['katibu', 'mwenyekiti', 'mhazini', 'mweka'],
]);
/** Words that qualify an office rather than name anyone ("Branch Manager", "Senior Officer"). */
const ROLE_QUALIFIERS = new Set(['branch', 'senior', 'deputy', 'assistant', 'chief', 'general']);
/** Capitalised words a span may hold that are no one's name ("Owner PIN", "Dear Sir"). */
const NOT_NAMES = new Set([
  ...['pin', 'no', 'no.', 'nos', 'nos.', 'number', 'id', 'kra', 'the', 'of', 'late'],
  ...TITLES,
  ...TITLES.map((title) => `${title}.`),
]);

const lower = (word: string) => word.toLowerCase();
const isOrganisationWord = (word: string | undefined) =>
  word !== undefined && ORGANISATION_WORDS.has(lower(word));
/** A word that qualifies an office before it: a company word or a qualifier ("Sacco", "Branch"). */
const qualifiesOffice = (word: string | undefined) =>
  isOrganisationWord(word) || (word !== undefined && ROLE_QUALIFIERS.has(lower(word)));

/** The parties after `start`: each a list of words, split at joiners. */
function readParties(text: string, start: number): string[][] {
  const parties: string[][] = [[]];
  let at = start;
  const sticky = (pattern: RegExp): RegExpExecArray | null => {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (match) at = pattern.lastIndex;
    return match;
  };
  sticky(LEAD);
  let words = 0;
  while (words < MAX_WORDS) {
    const word = sticky(NAME_WORD);
    if (word) {
      if (LABEL_WORD.test(word[0].replace(/[.:]$/u, ''))) break;
      parties.at(-1)?.push(word[0]);
      words++;
    } else if (sticky(FILLER)) {
      // "the late": no one's name, but the span goes on.
    } else if (sticky(JOINER)) {
      parties.push([]);
    } else {
      // A name may wrap onto the next line; an office or company it ends in may not.
      const last = parties.at(-1) ?? [];
      if (last.some((each) => ROLE_WORDS.has(lower(each)) || isOrganisationWord(each))) break;
      const continued = sticky(CONTINUATION);
      if (!continued?.[1]) break;
      const next = continued[1].split(' ');
      if (next.some((each) => LABEL_WORD.test(each))) break;
      parties.at(-1)?.push(...next);
      words += next.length;
      continue;
    }
    // Words, fillers and joiners are separated by one space, or none before punctuation.
    const before = at;
    if (!sticky(GAP) && /^[ \t]/u.test(text.slice(before, before + 1))) break;
  }
  return parties.filter((party) => party.length > 0);
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
    if (NOT_NAMES.has(lower(word))) continue;
    kept.push(word);
  }
  const names = kept
    .filter((word) => !isOrganisationWord(word) && word.length >= 2)
    .map((value): DocumentIdentifier => ({ value, cls: 'PERSON' }));
  return isOrganisationWord(kept.at(-1))
    ? [{ value: kept.join(' '), cls: 'ORGANISATION' }, ...names]
    : names;
}

/**
 * A number a page labels as a person's (membership, payroll, staff, personal, customer or policy
 * number, in English or Swahili), with letters and digits both (UW-00781): a digits-only one is
 * an ID or account number by its shape already, and an ordinal ("5th") is no number.
 */
const MEMBER_NUMBER = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?i:(?:member(?:ship)?|payroll|staff|personal|employee|customer|policy|tsc)\s+(?:no\.?|number)|nambari\s+ya\s+(?:uanachama|mwanachama|mshahara))[ \t]*[:\-]?[ \t]*(?!\d+(?:st|nd|rd|th)(?![\p{L}\p{N}]))((?=[A-Za-z0-9/-]*[A-Za-z])(?=[A-Za-z0-9/-]*\d)[A-Za-z0-9][A-Za-z0-9/-]{2,})`,
  'gu',
);

/**
 * What introduces an address on a page, at the start of a line, in English or Swahili; the rest
 * of the line is the address (a house, a plot, a street and a town), which no shape gives away.
 */
const ADDRESS = new RegExp(
  String.raw`^[ \t]*(?i:(?:physical|postal|residential|home)\s+address|address|residence|anwani(?:\s+ya\s+makazi)?|makazi)[ \t]*[:\-]?[ \t]*\r?\n?[ \t]*([^\r\n]*[\p{L}\p{N}][^\r\n]*)$`,
  'gmu',
);

/** The identifiers of a text layer, in the order the page holds them; repeats included. */
export function documentIdentifiers(text: string): DocumentIdentifier[] {
  const found: DocumentIdentifier[] = [];
  for (const introducer of INTRODUCERS) {
    for (const match of text.matchAll(introducer)) {
      for (const party of readParties(text, match.index + match[0].length)) {
        found.push(...partyIdentifiers(party));
      }
    }
  }
  for (const match of text.matchAll(MEMBER_NUMBER)) {
    if (match[1]) found.push({ value: match[1], cls: 'MEMBER_NUMBER' });
  }
  for (const match of text.matchAll(ADDRESS)) {
    const address = match[1]?.trim() ?? '';
    if (address.length >= 2) found.push({ value: address, cls: 'ADDRESS' });
  }
  return found;
}
