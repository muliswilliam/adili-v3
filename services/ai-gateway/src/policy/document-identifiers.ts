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
/** A whole word that is a label: where a label's span ends ("John Kamau Guarantor: ..."). */
const LABEL_WORD = new RegExp(`^(?i:${NAME_LABELS.join('|')})$`, 'u');
/** A title, then a dot or a space ("Mr.John", "Rev. Peter"); a salutation or formula, a space. */
const RUN_INTRODUCERS: readonly RegExp[] = [
  new RegExp(`${EDGE}(?i:${TITLES.join('|')})(?:\\.|(?=[ \\t]))`, 'gu'),
  new RegExp(
    `${EDGE}(?i:dear|mpendwa|ndugu|certify[ \\t]+that|imesainiwa[ \\t]+na)(?=[ \\t])`,
    'gu',
  ),
];

/**
 * A line's tokens, in one linear pass (no alternative backtracks over a long run): an existing
 * token, a run of letters, digits and apostrophes joined by `-` or `/` (a word: Ndung’u-Kamau; a
 * code or number when it holds a digit: UW-00781, 1187), spaces, a joining mark, or any other
 * character.
 */
const TOKEN =
  /\[\[[A-Z][A-Z_]*_\d+\]\]|[\p{L}\p{N}\p{M}'’]+(?:[-/][\p{L}\p{N}\p{M}'’]+)*|[ \t\u00a0]+|[,;/&]|[^]/gu;

type Token =
  | { kind: 'word'; text: string }
  | { kind: 'space'; width: number }
  | { kind: 'joiner' }
  | { kind: 'other'; text: string };

function tokensOf(line: string): Token[] {
  return Array.from(line.matchAll(TOKEN), ([text]): Token => {
    if (/^[ \t\u00a0]+$/u.test(text)) return { kind: 'space', width: text.length };
    if (/^[,;/&]$/u.test(text)) return { kind: 'joiner' };
    // A code, or a code-like word with a digit, is no name; a hyphenated name is one word.
    if (/^\p{L}/u.test(text) && !/\p{N}/u.test(text) && !text.startsWith('[[')) {
      return { kind: 'word', text };
    }
    return { kind: 'other', text };
  });
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
/** Words in a span, and parties, at most. */
const MAX_WORDS = 24;
const MAX_PARTIES = 8;

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
const ROLE_QUALIFIERS = new Set(['branch', 'senior', 'deputy', 'assistant', 'chief', 'general']);
/** Capitalised words no one is named ("Owner PIN", "Dear Sir", "the Late"). */
const NOT_NAMES = new Set([
  ...['pin', 'no', 'nos', 'number', 'id', 'kra', 'the', 'of', 'late', 'marehemu'],
  ...TITLES,
]);

const lower = (word: string) => word.toLowerCase();
const isOrganisationWord = (word: string | undefined) =>
  word !== undefined && ORGANISATION_WORDS.has(lower(word));
/** A word that qualifies an office before it: a company word or a qualifier ("Sacco", "Branch"). */
const qualifiesOffice = (word: string | undefined) =>
  isOrganisationWord(word) || (word !== undefined && ROLE_QUALIFIERS.has(lower(word)));
const isCapitalised = (word: string) => /^\p{Lu}/u.test(word);

/**
 * The parties in `tokens`. In a label's span (`label`), every capitalised word to the end of the
 * line or the next label word belongs to a party; lowercase words other than particles, and
 * joiners, end a party. In a run (after a title or salutation), the span ends at the first token
 * that is not a capitalised word, a particle or a single space.
 */
function partiesOf(tokens: readonly Token[], mode: 'label' | 'run'): string[][] {
  const parties: string[][] = [[]];
  const next = () => {
    if ((parties.at(-1)?.length ?? 0) > 0) parties.push([]);
  };
  let words = 0;
  for (const token of tokens) {
    if (words >= MAX_WORDS || parties.length > MAX_PARTIES) break;
    if (token.kind === 'word') {
      const word = token.text;
      if (isCapitalised(word)) {
        if (LABEL_WORD.test(word)) break;
        if (JOINER_WORDS.has(lower(word))) next();
        else {
          parties.at(-1)?.push(word);
          words++;
        }
      } else if (PARTICLES.has(word)) {
        // Inside a name: the span goes on.
      } else if (mode === 'run') {
        break;
      } else {
        next();
      }
    } else if (token.kind === 'space') {
      if (mode === 'run' && token.width > 1) break;
    } else if (token.kind === 'joiner') {
      if (mode === 'run') break;
      next();
    } else if (mode === 'run' && words > 0) {
      break;
    }
  }
  return parties.filter((party) => party.length > 0);
}

/** Whether a line holds only a name's words: it continues the name on the line above. */
function isNameLine(tokens: readonly Token[]): boolean {
  const words = tokens.filter((token) => token.kind === 'word');
  return (
    words.length > 0 &&
    words.length <= 6 &&
    tokens.every((token) => token.kind === 'word' || token.kind === 'space') &&
    words.every(
      (token) =>
        (isCapitalised(token.text) || PARTICLES.has(token.text)) && !LABEL_WORD.test(token.text),
    )
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
    if (NOT_NAMES.has(lower(word))) continue;
    kept.push(word);
  }
  // Each part of a joined name on its own ("Mary-Jane"), so either is found bare.
  const names = kept
    .filter((word) => !isOrganisationWord(word))
    .flatMap((word) => [word, ...(/[-/]/u.test(word) ? word.split(/[-/]/u) : [])])
    .filter((word) => word.length >= 2)
    .map((value): DocumentIdentifier => ({ value, cls: 'PERSON' }));
  return isOrganisationWord(kept.at(-1))
    ? [{ value: kept.join(' '), cls: 'ORGANISATION' }, ...names]
    : names;
}

/** Whether a label at `index` is one: capitalised, or followed by a colon or dash. */
function isLabel(line: string, index: number, end: number): boolean {
  if (isCapitalised(line.charAt(index))) return true;
  return /^[ \t]*[:-]/u.test(line.slice(end, end + 40));
}

/** Blank lines a label's name may come after. */
const MAX_BLANK_LINES = 3;

function labelParties(lines: readonly string[], row: number, column: number): string[][] {
  let tokens = tokensOf(lines[row]?.slice(column) ?? '');
  let last = row;
  if (!tokens.some((token) => token.kind === 'word' && isCapitalised(token.text))) {
    // The name is on a line below the label, after blank lines at most.
    const below = lines
      .slice(row + 1, row + 2 + MAX_BLANK_LINES)
      .findIndex((each) => each.trim() !== '');
    if (below < 0) return [];
    last = row + 1 + below;
    tokens = tokensOf(lines[last] ?? '');
  }
  const parties = partiesOf(tokens, 'label');
  // A name may wrap onto the next line; an office or company it ends in may not.
  const tail = parties.at(-1) ?? [];
  const wraps = !tail.some((word) => ROLE_WORDS.has(lower(word)) || isOrganisationWord(word));
  const following = tokensOf(lines[last + 1] ?? '');
  if (parties.length > 0 && wraps && isNameLine(following)) {
    parties.push(...partiesOf(following, 'label'));
  }
  return parties;
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
const ADDRESS = new RegExp(
  String.raw`^[ \t]*(?i:(?:physical|postal|residential|home)[ \t]+address|address|residence|anwani(?:[ \t]+ya[ \t]+makazi)?|makazi)${AFTER_WORD}[ \t]*(?:[:\-][ \t]*)?(.*)$`,
  'u',
);

/**
 * The identifiers of a text layer, in the order the page holds them; repeats included. `shapes`
 * are the identifiers minimisation finds by their shape (a parcel, a P.O. Box address, an ID):
 * their words are no one's name, so they are blanked before names are read.
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
  const nameLines = blanked.split(/\r?\n/u);
  const lines = text.split(/\r?\n/u);
  nameLines.forEach((line, row) => {
    for (const match of line.matchAll(LABEL)) {
      const end = match.index + match[0].length;
      if (!isLabel(line, match.index, end)) continue;
      for (const party of labelParties(nameLines, row, end)) {
        found.push(...partyIdentifiers(party));
      }
    }
    for (const introducer of RUN_INTRODUCERS) {
      for (const match of line.matchAll(introducer)) {
        const tokens = tokensOf(line.slice(match.index + match[0].length));
        // Spaces before the name are no gap.
        const first = tokens.findIndex((token) => token.kind !== 'space');
        for (const party of partiesOf(first < 0 ? [] : tokens.slice(first), 'run')) {
          found.push(...partyIdentifiers(party));
        }
      }
    }
    const original = lines[row] ?? '';
    for (const match of original.matchAll(MEMBER_NUMBER)) {
      const number = match[1] ?? '';
      if (/\p{L}/u.test(number) && /\d/u.test(number) && !ORDINAL.test(number)) {
        found.push({ value: number, cls: 'MEMBER_NUMBER' });
      }
    }
    const address = ADDRESS.exec(original);
    if (address) {
      // The address, or the line below a label that stands alone.
      const rest = address[1]?.trim() ?? '';
      const below =
        lines.slice(row + 1, row + 2 + MAX_BLANK_LINES).find((each) => each.trim() !== '') ?? '';
      const value = rest === '' ? below.trim() : rest;
      if (value.length >= 2) found.push({ value, cls: 'ADDRESS' });
    }
  });
  return found;
}
