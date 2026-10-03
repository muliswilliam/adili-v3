import {
  type NarrateInput,
  type NarrateOutput,
  narrateComplianceReport,
} from '../../src/tasks/narrate-compliance-report.js';
import { narrativeViolations } from '../../src/tasks/narrative-validation.js';
import { type Score, fromChecks } from '../lib/score.js';
import type { EvalSuite, GoldenCase } from '../lib/suite.js';
import { quote } from '../lib/text.js';

/**
 * Synthetic NCR aggregates for six Commissions over FY2024 to FY2026 (spec 09b S10), shaped as
 * the reporting service builds them, with the patterns its candidate module would compute: the
 * Teachers Service Commission's non-filer rate doubles in FY2026, the Commission on Revenue
 * Allocation reports late three years running, the National Police Service Commission's non-filer
 * rate breaches 10% and the Judicial Service Commission's clarification ratio is an outlier. The
 * names are real bodies; every figure is invented.
 */

type Year = 2024 | 2025 | 2026;

/** Declarations expected, filed, filed late and clarifications issued, per year. */
type Counts = Record<Year, [expected: number, filed: number, late: number, clarifications: number]>;

const COMMISSIONS: readonly { code: string; name: string; counts: Counts }[] = [
  {
    code: 'tsc',
    name: 'Teachers Service Commission',
    counts: {
      2024: [8000, 7700, 400, 310],
      2025: [8100, 7770, 420, 320],
      2026: [8200, 7530, 450, 330],
    },
  },
  {
    code: 'psc',
    name: 'Public Service Commission',
    counts: {
      2024: [4200, 4080, 150, 120],
      2025: [4250, 4140, 140, 125],
      2026: [4280, 4180, 130, 118],
    },
  },
  {
    code: 'npsc',
    name: 'National Police Service Commission',
    counts: {
      2024: [2100, 1950, 120, 60],
      2025: [2150, 1960, 130, 62],
      2026: [2200, 1950, 140, 65],
    },
  },
  {
    code: 'jsc',
    name: 'Judicial Service Commission',
    counts: {
      2024: [900, 880, 30, 40],
      2025: [920, 895, 28, 42],
      2026: [940, 915, 25, 141],
    },
  },
  {
    code: 'src',
    name: 'Salaries and Remuneration Commission',
    counts: { 2024: [150, 148, 6, 3], 2025: [155, 152, 5, 3], 2026: [160, 158, 4, 4] },
  },
  {
    code: 'cra',
    name: 'Commission on Revenue Allocation',
    counts: { 2024: [120, 112, 38, 4], 2025: [125, 116, 41, 5], 2026: [130, 121, 45, 5] },
  },
];

/** A rate as the reporting service sends it: a fraction to four places. */
const rate = (part: number, whole: number) => Math.round((part / whole) * 10_000) / 10_000;

function figures([expected, filed, late, clarifications]: Counts[Year]) {
  const nonFilers = expected - filed;
  return {
    counts: { expected, filed, late, nonFilers, clarifications },
    rates: {
      filingRate: rate(filed, expected),
      nonFilerRate: rate(nonFilers, expected),
      lateRate: rate(late, filed),
      clarificationRatio: rate(clarifications, filed),
    },
  };
}

function yearOf(fy: Year) {
  const rows = COMMISSIONS.map(({ code, name, counts }) => {
    const { counts: own, rates } = figures(counts[fy]);
    return { code, commissionName: name, figures: { ...own, ...rates } };
  });
  const sum = (index: 0 | 1 | 2 | 3) =>
    COMMISSIONS.reduce((total, { counts }) => total + counts[fy][index], 0);
  const national = figures([sum(0), sum(1), sum(2), sum(3)]);
  return { fy, totals: national.counts, rates: national.rates, commissionTable: rows };
}

const figure = (fy: Year, code: string, name: keyof ReturnType<typeof figures>['rates']) => {
  const row = yearOf(fy).commissionTable.find((each) => each.code === code);
  if (!row) throw new Error(`No Commission ${code}`);
  return row.figures[name];
};

const key = (fy: Year, current: Year, code: string, name: string) =>
  `${fy === current ? '' : `fy${fy}.`}commission.${code}.${name}`;

/** The candidates the reporting service computes for a year, given the years before it. */
function candidatesFor(fy: Year): NarrateInput['candidates'] {
  const lateThreshold = 0.25;
  const years = ([2024, 2025, 2026] as const).filter((each) => each <= fy);
  const candidates: NarrateInput['candidates'] = [
    {
      id: `threshold-breach:cra:lateRate`,
      kind: 'threshold-breach',
      subject: 'cra',
      values: { lateRate: figure(fy, 'cra', 'lateRate'), threshold: lateThreshold },
      aggregateKeys: [key(fy, fy, 'cra', 'lateRate')],
    },
  ];
  if (fy === 2026) {
    candidates.push(
      {
        id: 'rate-change:tsc:nonFilerRate',
        kind: 'rate-change',
        subject: 'tsc',
        values: {
          from: figure(2025, 'tsc', 'nonFilerRate'),
          to: figure(2026, 'tsc', 'nonFilerRate'),
        },
        aggregateKeys: [key(2025, fy, 'tsc', 'nonFilerRate'), key(2026, fy, 'tsc', 'nonFilerRate')],
      },
      {
        id: 'threshold-breach:npsc:nonFilerRate',
        kind: 'threshold-breach',
        subject: 'npsc',
        values: { nonFilerRate: figure(2026, 'npsc', 'nonFilerRate'), threshold: 0.1 },
        aggregateKeys: [key(2026, fy, 'npsc', 'nonFilerRate')],
      },
      {
        id: 'clarification-ratio-outlier:jsc:clarificationRatio',
        kind: 'clarification-ratio-outlier',
        subject: 'jsc',
        values: {
          clarificationRatio: figure(2026, 'jsc', 'clarificationRatio'),
          nationalRatio: yearOf(2026).rates.clarificationRatio,
        },
        aggregateKeys: [key(2026, fy, 'jsc', 'clarificationRatio'), 'national.clarificationRatio'],
      },
      {
        id: 'chronic-late-reporting:cra:lateRate',
        kind: 'chronic-late-reporting',
        subject: 'cra',
        values: {
          years: years.length,
          ...Object.fromEntries(
            years.map((each) => [`fy${each}`, figure(each, 'cra', 'lateRate')]),
          ),
          threshold: lateThreshold,
        },
        aggregateKeys: years.map((each) => key(each, fy, 'cra', 'lateRate')),
      },
    );
  }
  return candidates;
}

function narrateInput(fy: Year, section: NarrateInput['section']): NarrateInput {
  return {
    kind: 'narrate-compliance-report',
    ...yearOf(fy),
    priorYears: ([2025, 2024] as const).filter((each) => each < fy).map(yearOf),
    candidates: candidatesFor(fy),
    section,
    language: 'en',
  };
}

/** Nothing case-specific: every case is scored by the validator and candidate coverage. */
type Expected = Record<string, never>;

function golden(name: string, fy: Year, section: NarrateInput['section']): GoldenCase<Expected> {
  return { name, input: narrateInput(fy, section), expected: {} };
}

/** Hard: the draft passes the checks a job applies (spec 09b S2), quoting what fails. */
function narrativeValid(input: NarrateInput, output: NarrateOutput): Score {
  return fromChecks(
    'narrative-valid',
    true,
    narrativeViolations(input, output).map((violation) => {
      const paragraph =
        typeof violation.paragraph === 'number'
          ? output.paragraphs[violation.paragraph]
          : undefined;
      return {
        ok: false,
        failure: `${JSON.stringify(violation)}${paragraph ? ` in ${quote(paragraph.text)}` : ''}`,
      };
    }),
  );
}

/** Soft, where findings are drafted: each candidate is narrated by at least one finding. */
function candidateCoverage(input: NarrateInput, output: NarrateOutput): Score[] {
  if (input.section !== 'all' && input.section !== 'findings') return [];
  const narrated = new Set(
    output.paragraphs
      .filter((each) => each.section === 'findings')
      .flatMap((each) => each.candidateIds),
  );
  return [
    fromChecks(
      'candidate-coverage',
      false,
      input.candidates.map((candidate) => ({
        ok: narrated.has(candidate.id),
        failure: `candidate ${candidate.id} is in no finding`,
      })),
    ),
  ];
}

export const narrateSuite: EvalSuite<Expected> = {
  task: narrateComplianceReport,
  // Recorded before the default moved to claude-opus-5-5 (evals/README.md); re-record with v2.
  model: 'claude-sonnet-5',
  cases: [
    golden('FY2024, all sections, no prior year', 2024, 'all'),
    golden('FY2025, all sections, one prior year', 2025, 'all'),
    golden('FY2026, all sections, two prior years', 2026, 'all'),
    golden('FY2026 overview', 2026, 'overview'),
    golden('FY2026 findings', 2026, 'findings'),
    golden('FY2026 recommendations', 2026, 'recommendations'),
  ],
  score(input, output) {
    const parsed = narrateComplianceReport.input.parse(input);
    const typed = output as NarrateOutput;
    return [narrativeValid(parsed, typed), ...candidateCoverage(parsed, typed)];
  },
  thresholds: { 'candidate-coverage': 0.8 },
};
