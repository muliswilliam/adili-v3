import type { NarrateInput, NarrateOutput } from './narrate-compliance-report.js';
import type { OutputViolation } from './task.js';

/** The NCR narrative sections a paragraph belongs to. */
export const NARRATIVE_SECTIONS = ['overview', 'findings', 'recommendations'] as const;
type Section = (typeof NARRATIVE_SECTIONS)[number];

/** Paragraphs a section may hold: a draft the analyst can edit, not a report of every row. */
export const SECTION_PARAGRAPH_LIMITS: Readonly<Record<Section, number>> = {
  overview: 3,
  findings: 12,
  recommendations: 6,
};

/**
 * Why a drafted NCR narrative fails (spec 09b S2); empty when every figure it states and every
 * key and candidate it cites is in the input.
 */
export function narrativeViolations(input: NarrateInput, output: NarrateOutput): OutputViolation[] {
  const known = inputNumbers(input);
  const years = new Set([input.fy, ...input.priorYears.map((each) => each.fy)]);
  const keys = aggregateKeys(input);
  const candidates = new Set(input.candidates.map((each) => each.id));
  return [
    ...output.paragraphs.flatMap((paragraph, index) => paragraphViolations(paragraph, index)),
    ...sectionViolations(input.section, output),
  ];

  function paragraphViolations(
    paragraph: NarrateOutput['paragraphs'][number],
    index: number,
  ): OutputViolation[] {
    return [
      ...foreignNumbers(paragraph.text, known, years).map((): OutputViolation => ({
        kind: 'foreign-number',
        paragraph: index,
      })),
      // By position, not value: an unknown ref or id is text the model wrote.
      ...paragraph.aggregateRefs.flatMap((ref, at): OutputViolation[] =>
        keys.has(ref) ? [] : [{ kind: 'unknown-ref', paragraph: index, index: at }],
      ),
      ...paragraph.candidateIds.flatMap((candidate, at): OutputViolation[] =>
        candidates.has(candidate)
          ? []
          : [{ kind: 'unknown-candidate', paragraph: index, index: at }],
      ),
      // A finding narrates a computed pattern; it does not discover one (ADR-007).
      ...(paragraph.section === 'findings' && paragraph.candidateIds.length === 0
        ? [{ kind: 'finding-without-candidate' as const, paragraph: index }]
        : []),
      ...(input.section !== 'all' && paragraph.section !== input.section
        ? [{ kind: 'wrong-section' as const, paragraph: index, section: paragraph.section }]
        : []),
    ];
  }
}

/** Each section asked for has at least one paragraph and no more than its limit. */
function sectionViolations(
  asked: NarrateInput['section'],
  output: NarrateOutput,
): OutputViolation[] {
  const sections = asked === 'all' ? NARRATIVE_SECTIONS : [asked];
  return sections.flatMap((section): OutputViolation[] => {
    const count = output.paragraphs.filter((each) => each.section === section).length;
    const limit = SECTION_PARAGRAPH_LIMITS[section];
    if (count === 0) return [{ kind: 'missing-section', section }];
    if (count > limit) return [{ kind: 'too-many-paragraphs', section, limit }];
    return [];
  });
}

/**
 * The aggregate key of every figure in the input: `national.<name>` for totals and rates,
 * `commission.<code>.<name>` for a Commission row, and the same prefixed `fy<fy>.` for a prior
 * year. Codes and names are not figures and have no key.
 */
export function aggregateKeys(input: NarrateInput): Set<string> {
  const years = [
    { prefix: '', year: input },
    ...input.priorYears.map((year) => ({ prefix: `fy${year.fy}.`, year })),
  ];
  return new Set(
    years.flatMap(({ prefix, year }) => [
      ...[...Object.keys(year.totals), ...Object.keys(year.rates)].map(
        (name) => `${prefix}national.${name}`,
      ),
      ...year.commissionTable.flatMap(({ code, figures }) =>
        Object.keys(figures).map((name) => `${prefix}commission.${code}.${name}`),
      ),
    ]),
  );
}

/**
 * A financial year label, "2025/26", "2025-26" or "FY2025/2026", or a range of years, "2024-2026".
 * The dash is a hyphen, an en dash or an em dash, as in a range of figures (RANGE_JOIN).
 */
const FY_LABEL = /\b(?:FY\s?)?(\d{4})[/\-\u2013\u2014](\d{2}|\d{4})\b/giu;

/** A bare four-digit whole number in this range reads as a year, not a count ("in 2025"). */
const YEARS = { from: 1900, to: 2099 };

/** Places a percentage may be rounded to; more is not a rounding of an input rate. */
const MAX_PERCENT_DECIMALS = 2;

/**
 * A number as written: digits with optional thousands separators (comma, thin or narrow
 * no-break space), decimals, and a percentage unit. Digits after a letter and a dot count
 * ("s.31"); digits after a number's decimal point do not. A thousands group is read whole, so
 * digits after a comma that makes no group are a number of their own: "17,5%" states 17 and 5%,
 * "120,45" states 120 and 45, and each is checked. A group is three digits and no more, so
 * "11,2045" states 11 and 2045, not 11,204. A decimal point with no digits before it and no letter
 * either starts a fraction: ".5%" states 0.5%, not 5%. A full stop then a space starts no
 * fraction ("filed. 12 Commissions" states 12).
 */
const NUMBER =
  /(?<!\d|\d\.)(?:(\d{1,3}(?:[,\u2009\u202f]\d{3}(?!\d))+|\d+)|(?<![\p{L}\d])(?=\.\d))(?:\.(\d+))?(\s*(?:%|per\s?cent\b|percentage points?\b|pp\b))?/giu;

interface Mention {
  value: number;
  /** Decimal places as written: the precision a figure was rounded to. */
  decimals: number;
  percent: boolean;
  /**
   * A unit carried back from the end of a range or list ("8.2 to 16.4%"). It is a second reading,
   * not a replacement: "670 - 8.2%" or "Of 960, 16.4%" may be a count next to a share, so the
   * number is stated if the input holds it as written or as a percentage.
   */
  carried: boolean;
  /** Four digits, no separator, no decimals or unit: a year. */
  year: boolean;
}

/** Stands in for an FY label taken out of the text, so a range can step over it. */
const LABEL_GAP = '\uE000';

/**
 * What joins two numbers of one range or list, "8.2 to 16.4%", "between 8.2 and 16.4%",
 * "8.2-16.4%" or "5.1, 8.2 and 16.4%", with at most an FY label before the join ("8.2 in
 * FY2024/25 to 16.4%"). Nothing else: a unit does not carry across other words or a sentence.
 * The dash is a hyphen, an en dash or an em dash.
 */
const RANGE_JOIN =
  /^\s*(?:(?:in\s+)?\uE000\s*)?(?:to|and|,(?:\s*(?:and|to)\b)?|[-\u2013\u2014])\s*$/iu;

/**
 * The numbers in `text`. A unit written once, after the last number of a range or list, is carried
 * to the numbers before it: "from 8.2 to 16.4 per cent" and "5.1, 8.2 and 16.4%" may state only
 * percentages. A year is not part of a range of figures ("in FY2024 to 35.3% in FY2025").
 */
function mentions(text: string): Mention[] {
  const matches = [...text.matchAll(NUMBER)];
  const found = matches.map(([, integer = '', fraction, unit]): Mention => {
    const value = Number(`${integer.replaceAll(/[,\u2009\u202f]/g, '')}.${fraction ?? '0'}`);
    return {
      value,
      decimals: fraction?.length ?? 0,
      percent: Boolean(unit),
      carried: false,
      year:
        /^\d{4}$/.test(integer) && !fraction && !unit && value >= YEARS.from && value <= YEARS.to,
    };
  });
  // From the last, so a unit carries along a chain: "8.2 to 9.1 to 16.4%".
  for (let at = found.length - 2; at >= 0; at -= 1) {
    const [current, next] = [found[at], found[at + 1]];
    const [written, following] = [matches[at], matches[at + 1]];
    if (!current || !next || !written || !following) continue;
    if (current.percent || current.year || !(next.percent || next.carried)) continue;
    const between = text.slice(written.index + written[0].length, following.index);
    current.carried = RANGE_JOIN.test(between);
  }
  return found;
}

type InputNumbers = Readonly<Record<'all' | 'rates', readonly number[]>>;

/**
 * The figures the input states, unsigned: a fall of 0.12 reads as "fell by 12%". `rates` are the
 * figures a percentage may state: every national rate, and any other figure that is not a whole
 * number above 1, since counts are whole and rates are fractions. A Commission's figures and a
 * candidate's values hold both, so a count of 0 or 1 still reads as 0% or 100%.
 */
function inputNumbers(input: NarrateInput): InputNumbers {
  const years = [input, ...input.priorYears];
  const unsigned = (values: readonly (number | string | null)[]) =>
    values.filter((value): value is number => typeof value === 'number').map(Math.abs);
  const national = unsigned(years.flatMap((year) => Object.values(year.rates)));
  const counts = unsigned(years.flatMap((year) => Object.values(year.totals)));
  const mixed = unsigned([
    ...years.flatMap((year) => year.commissionTable.flatMap((row) => Object.values(row.figures))),
    ...input.candidates.flatMap((candidate) => Object.values(candidate.values)),
  ]);
  return {
    all: [...national, ...counts, ...mixed],
    rates: [...national, ...mixed.filter((value) => !Number.isInteger(value) || value <= 1)],
  };
}

/**
 * Half-up rounding as on paper. The scaled value is first cut to 12 significant digits, so a
 * binary near-miss rounds as its decimal does: 0.0515 × 1000 is 51.4999…, read as 51.5.
 */
function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(Number((value * scale).toPrecision(12))) / scale;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Whether the input states a mention. A percentage matches a rate ×100 rounded as written, to at
 * most two places; a year matches an input FY; another whole number matches exactly; a
 * decimal matches rounded as written. A number with a carried unit matches either way. Nothing
 * derived: a difference or ratio passes only when the input carries it.
 */
function inputStates(mention: Mention, known: InputNumbers, years: ReadonlySet<number>): boolean {
  if (mention.carried && inputStatesAs({ ...mention, percent: true }, known, years)) return true;
  return inputStatesAs(mention, known, years);
}

function inputStatesAs(
  { value, decimals, percent, year }: Mention,
  known: InputNumbers,
  years: ReadonlySet<number>,
): boolean {
  if (percent) {
    return (
      decimals <= MAX_PERCENT_DECIMALS &&
      known.rates.some((each) => approxEqual(round(each * 100, decimals), value))
    );
  }
  if (year) return years.has(value);
  if (decimals === 0) return known.all.some((each) => approxEqual(each, value));
  return known.all.some((each) => approxEqual(round(each, decimals), value));
}

/**
 * The mentions in `text` the input does not state; a year or FY label counts when it is an input
 * FY, and a range of years ("2024-2026") when both its years are.
 */
function foreignNumbers(text: string, known: InputNumbers, years: ReadonlySet<number>): Mention[] {
  const labels = [...text.matchAll(FY_LABEL)];
  const foreignLabels = labels
    .filter(
      ([, start = '', end = '']) =>
        !labelYears(Number(start), end).every((year) => years.has(year)),
    )
    .map((): Mention => ({
      value: Number.NaN,
      decimals: 0,
      percent: false,
      carried: false,
      year: true,
    }));
  const rest = text.replaceAll(FY_LABEL, ` ${LABEL_GAP} `);
  return [
    ...foreignLabels,
    ...mentions(rest).filter((mention) => !inputStates(mention, known, years)),
  ];
}

/**
 * The years a label names: the one an FY ends in ("2025/26" is 2026), or both ends of a range
 * whose years are not consecutive ("2024-2026", "2025/27").
 */
function labelYears(start: number, end: string): number[] {
  const year = end.length === 2 ? Math.floor(start / 100) * 100 + Number(end) : Number(end);
  return year === start + 1 ? [year] : [start, year];
}
