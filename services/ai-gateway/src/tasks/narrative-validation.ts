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
      ...foreignNumbers(paragraph.text, known, years).map(() => ({
        kind: 'foreign-number',
        paragraph: index,
      })),
      // By position, not value: an unknown ref or id is text the model wrote.
      ...paragraph.aggregateRefs.flatMap((ref, at) =>
        keys.has(ref) ? [] : [{ kind: 'unknown-ref', paragraph: index, index: at }],
      ),
      ...paragraph.candidateIds.flatMap((candidate, at) =>
        candidates.has(candidate)
          ? []
          : [{ kind: 'unknown-candidate', paragraph: index, index: at }],
      ),
      // A finding narrates a computed pattern; it does not discover one (ADR-007).
      ...(paragraph.section === 'findings' && paragraph.candidateIds.length === 0
        ? [{ kind: 'finding-without-candidate', paragraph: index }]
        : []),
      ...(input.section !== 'all' && paragraph.section !== input.section
        ? [{ kind: 'wrong-section', paragraph: index, section: paragraph.section }]
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

/** A financial year label, "2025/26", "2025-26" or "FY2025/2026", or a range of years, "2024–2026". */
const FY_LABEL = /\b(?:FY\s?)?(\d{4})[/\-–](\d{2}|\d{4})\b/giu;

/** A bare four-digit whole number in this range reads as a year, not a count ("in 2025"). */
const YEARS = { from: 1900, to: 2099 };

/** Places a percentage may be rounded to; more is not a rounding of an input rate. */
const MAX_PERCENT_DECIMALS = 2;

/**
 * A number as written: digits with optional thousands separators (comma, thin or narrow
 * no-break space), decimals, and a percentage unit. Digits after a letter and a dot count
 * ("s.31"); digits after a number's own separator do not.
 */
const NUMBER =
  /(?<!\d|\d[.,])(\d{1,3}(?:[,\u2009\u202f]\d{3})+|\d+)(?:\.(\d+))?(\s*(?:%|per\s?cent\b|percentage points?\b|pp\b))?/giu;

interface Mention {
  value: number;
  /** Decimal places as written: the precision a figure was rounded to. */
  decimals: number;
  percent: boolean;
  /** Four digits, no separator, no decimals or unit: a year. */
  year: boolean;
}

function mentions(text: string): Mention[] {
  return [...text.matchAll(NUMBER)].map(([, integer = '', fraction, unit]) => {
    const value = Number(`${integer.replaceAll(/[,\u2009\u202f]/g, '')}.${fraction ?? '0'}`);
    return {
      value,
      decimals: fraction?.length ?? 0,
      percent: Boolean(unit),
      year:
        /^\d{4}$/.test(integer) && !fraction && !unit && value >= YEARS.from && value <= YEARS.to,
    };
  });
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

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Whether the input states a mention. A percentage matches a rate ×100 rounded as written, to at
 * most two places; a year matches an input FY; another whole number matches exactly; a
 * decimal matches rounded as written. Nothing derived: a difference or ratio passes only when
 * the input carries it.
 */
function stated(
  { value, decimals, percent, year }: Mention,
  known: InputNumbers,
  years: ReadonlySet<number>,
): boolean {
  if (percent) {
    return (
      decimals <= MAX_PERCENT_DECIMALS &&
      known.rates.some((each) => same(round(each * 100, decimals), value))
    );
  }
  if (year) return years.has(value);
  if (decimals === 0) return known.all.some((each) => same(each, value));
  return known.all.some((each) => same(round(each, decimals), value));
}

/**
 * The mentions in `text` the input does not state; a year or FY label counts when it is an input
 * FY, and a range of years ("2024–2026") when both its years are.
 */
function foreignNumbers(text: string, known: InputNumbers, years: ReadonlySet<number>): Mention[] {
  const labels = [...text.matchAll(FY_LABEL)];
  const foreignLabels = labels
    .filter(
      ([, start = '', end = '']) =>
        !labelYears(Number(start), end).every((year) => years.has(year)),
    )
    .map((): Mention => ({ value: Number.NaN, decimals: 0, percent: false, year: true }));
  const rest = text.replaceAll(FY_LABEL, ' ');
  return [...foreignLabels, ...mentions(rest).filter((mention) => !stated(mention, known, years))];
}

/**
 * The years a label names: the one an FY ends in ("2025/26" is 2026), or both ends of a range
 * whose years are not consecutive ("2024–2026", "2025/27").
 */
function labelYears(start: number, end: string): number[] {
  const year = end.length === 2 ? Math.floor(start / 100) * 100 + Number(end) : Number(end);
  return year === start + 1 ? [year] : [start, year];
}
