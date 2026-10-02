import { describe, expect, it } from 'vitest';

import type { NarrateOutput } from '../../src/tasks/narrate-compliance-report.js';
import { narrativeViolations } from '../../src/tasks/narrative-validation.js';
import { narrateInput as input, narrateOutput as output } from '../support/inputs.js';

/** The output with one paragraph replaced. */
function withParagraph(index: number, changes: Partial<NarrateOutput['paragraphs'][number]>) {
  const paragraphs = output.paragraphs.map((each, at) =>
    at === index ? { ...each, ...changes } : each,
  );
  return { paragraphs };
}

describe('narrative validation', () => {
  it('passes a narrative whose figures and citations are all in the input', () => {
    expect(narrativeViolations(input, output)).toEqual([]);
  });

  it('fails a figure the input does not hold, naming the paragraph but not the figure', () => {
    const drafted = withParagraph(0, { text: 'In FY2025/26, 11,950 declarations were filed.' });

    expect(narrativeViolations(input, drafted)).toEqual([{ kind: 'foreign-number', paragraph: 0 }]);
  });

  describe('numbers', () => {
    const foreign = (text: string) =>
      narrativeViolations(input, withParagraph(0, { text })).map((each) => each.kind);

    it('reads a rate as a percentage rounded to the places written', () => {
      expect(foreign('The non-filer rate was 16%, or 16.4%, or 16.40%.')).toEqual([]);
      expect(foreign('The non-filer rate was 16.5%.')).toEqual(['foreign-number']);
      expect(foreign('The non-filer rate was 16.41%.')).toEqual(['foreign-number']);
    });

    it('reads a percentage only as a rate ×100, never a rate as written', () => {
      expect(foreign('Late filings were 960%.')).toEqual(['foreign-number']);
      expect(foreign('The late rate was 0.08%.')).toEqual(['foreign-number']);
    });

    it('never reads a percentage as a count ×100, wherever the count is', () => {
      const counted = {
        ...input,
        totals: { ...input.totals, notReported: 3 },
        commissionTable: input.commissionTable.map((row) => ({
          ...row,
          figures: { ...row.figures, reportedLate: 4 },
        })),
        candidates: input.candidates.map((each) => ({
          ...each,
          values: { ...each.values, years: 5 },
        })),
      };
      const text = 'Late filings rose by 300%, 400% and 500%.';
      expect(
        narrativeViolations(counted, withParagraph(0, { text })).map((each) => each.kind),
      ).toEqual(['foreign-number', 'foreign-number', 'foreign-number']);
      expect(narrativeViolations(counted, withParagraph(0, { text: 'Of 3, 4 and 5.' }))).toEqual(
        [],
      );
    });

    it('reads a whole-number percentage of a rate, and a rate of 0 or 1 in a mixed row', () => {
      const whole = {
        ...input,
        rates: { ...input.rates, nonFilerRate: 0.25 },
        commissionTable: [
          ...input.commissionTable,
          {
            code: 'src',
            commissionName: 'Salaries and Remuneration Commission',
            figures: { filingRate: 1, nonFilerRate: 0 },
          },
        ],
      };
      const text = 'Non-filers were 25% nationally, and 0% at SRC, which filed 100%.';
      expect(narrativeViolations(whole, withParagraph(0, { text }))).toEqual([]);
    });

    it('rounds half up in decimal, as a reader would', () => {
      const rates = { ...input, rates: { filingRate: 0.0515, lateRate: 0.0705 } };
      const text = 'Rates of 5.2% and 7.1%.';
      expect(narrativeViolations(rates, withParagraph(0, { text }))).toEqual([]);
    });

    it('fails a percentage written to more than two places', () => {
      expect(foreign('The non-filer rate was 16.400%.')).toEqual(['foreign-number']);
    });

    it('reads a change in percentage points, unsigned', () => {
      expect(foreign('The rate rose by 100 per cent.')).toEqual([]);
    });

    it('carries a unit written once across a range', () => {
      expect(foreign('The rate rose from 8.2 to 16.4 per cent.')).toEqual([]);
      expect(foreign('The rate was 8.2–16.4%, between 8.2 and 16.4%, or 8.2 - 16.4%.')).toEqual([]);
      expect(foreign('The rate was 8.2\u201416.4%.')).toEqual([]);
      expect(foreign('The rate rose from 8.2 to 16.4 percentage points.')).toEqual([]);
      // A year is not one end of a range of percentages.
      expect(foreign('It rose from 8.2% in 2025 to 16.4% in 2026.')).toEqual([]);
    });

    it('carries a unit written once along a list, and over an FY label in a range', () => {
      expect(foreign('Its non-filer rates were 5.1, 8.2 and 16.4 per cent.')).toEqual([]);
      expect(foreign('Rates of 8.2, 16.4%.')).toEqual([]);
      expect(foreign('It rose from 8.2 in FY2024/25 to 16.4 per cent in FY2025/26.')).toEqual([]);
    });

    it('still fails a foreign number at either end of a range', () => {
      expect(foreign('The rate rose from 8.3 to 16.4 per cent.')).toEqual(['foreign-number']);
      expect(foreign('The rate was 8.2–16.5%.')).toEqual(['foreign-number']);
      // A carried unit is a second reading, so a count before a percentage is still a count.
      expect(foreign('Of 960, 16.4% were late.')).toEqual([]);
    });

    it('still fails a foreign number in a list, and does not carry across other words', () => {
      expect(foreign('Its non-filer rates were 5.1, 7.9 and 16.4 per cent.')).toEqual([
        'foreign-number',
      ]);
      // Across a sentence or other words, 8.2 is a bare decimal, not 8.2%.
      expect(foreign('The figure was 8.2. In all, 16.4% were late.')).toEqual(['foreign-number']);
      expect(foreign('It was 8.2 at most, then 16.4%.')).toEqual(['foreign-number']);
    });

    it('reads a number before a carried unit as written or as a percentage, never neither', () => {
      const counted = {
        ...input,
        totals: { ...input.totals, filed: 14_854 },
        rates: { ...input.rates, filingRate: 0.9336 },
        commissionTable: input.commissionTable.map((row) =>
          row.code === 'tsc'
            ? { ...row, figures: { ...row.figures, nonFilers: 670, nonFilerRate: 0.0817 } }
            : row,
        ),
      };
      const kinds = (text: string) =>
        narrativeViolations(counted, withParagraph(0, { text })).map((each) => each.kind);
      // A count next to a share, both in the input.
      expect(kinds('Non-filers numbered 670 – 8.2% of the 8,200 expected.')).toEqual([]);
      expect(kinds('Filings reached 14,854 and 93.4% of declarations were filed on time.')).toEqual(
        [],
      );
      // Neither 671 nor 6.71% is in the input.
      expect(kinds('Non-filers numbered 671 – 8.2% of the 8,200 expected.')).toEqual([
        'foreign-number',
      ]);
      // A count before a range does not let a count ×100 through at its end.
      expect(kinds('Non-filers numbered 670 – 67000%.')).toEqual(['foreign-number']);
    });

    it('strips thousands separators, comma, thin or narrow no-break space', () => {
      expect(foreign('Filed: 11,204, 11\u2009204 and 11\u202f204.')).toEqual([]);
    });

    it('checks digits after a comma that makes no thousands group as a number of their own', () => {
      const small = {
        ...input,
        totals: { ...input.totals, filed: 120 },
        rates: { ...input.rates, lateRate: 0.1235 },
        // No input rate rounds to 5%.
        commissionTable: input.commissionTable.map((row) => ({
          ...row,
          figures: { expected: 17, nonFilerRate: 0.164 },
        })),
      };
      const kinds = (text: string) =>
        narrativeViolations(small, withParagraph(0, { text })).map((each) => each.kind);

      expect(kinds('17,5% of filers.')).toEqual(['foreign-number']);
      expect(kinds('From 120,45 and 17.')).toEqual(['foreign-number']);
      expect(kinds('From 120, 17 and 12.35%.')).toEqual([]);
    });

    it('reads a decimal with no whole part as a fraction, not as the digits after its point', () => {
      // PSC's non-filer rate of 0.051 rounds to 5%, so ".5%" read as 5% would pass.
      expect(foreign('Non-filers were .5% of officers.')).toEqual(['foreign-number']);
      expect(foreign('Non-filers were (.5%) of officers.')).toEqual(['foreign-number']);

      const half = { ...input, rates: { ...input.rates, nonFilerRate: 0.005 } };
      const kinds = (text: string) =>
        narrativeViolations(half, withParagraph(0, { text })).map((each) => each.kind);
      expect(kinds('Non-filers were .5% of officers, or 0.5%.')).toEqual([]);
      expect(kinds('Non-filers were .50 per cent.')).toEqual([]);
    });

    it('reads a full stop before a number as the end of a sentence, not a decimal point', () => {
      const twelve = { ...input, totals: { ...input.totals, notReported: 12 } };
      const kinds = (text: string) =>
        narrativeViolations(twelve, withParagraph(0, { text })).map((each) => each.kind);

      expect(kinds('Most were filed. 12 were not reported.')).toEqual([]);
      expect(kinds('Under s.12 of the Act.')).toEqual([]);
      expect(foreign('Most were filed. 12 were not reported.')).toEqual(['foreign-number']);
    });

    it('reads a thousands group as three digits, so digits that run on after it are checked', () => {
      const grouped = {
        ...input,
        totals: { ...input.totals, late: 12_345, notReported: 1_234_567 },
        rates: { ...input.rates, lateRate: 0.125 },
      };
      const kinds = (text: string) =>
        narrativeViolations(grouped, withParagraph(0, { text })).map((each) => each.kind);

      // 11,204 and 12,345 are in the input; 11, 2045, 12 and 3456 are not.
      const both = ['foreign-number', 'foreign-number'];
      expect(kinds('11,2045 declarations were filed.')).toEqual(both);
      expect(kinds('12,3456 declarations were filed.')).toEqual(both);
      expect(kinds('12\u20093456 declarations were filed.')).toEqual(both);
      expect(kinds('Filed: 11,204 and 12,345, of 1,234,567 and 1\u202f234\u202f567.')).toEqual([]);
      expect(kinds('In FY2025/26 and 2025/26, 12.5% were late, from 8.2 to 16.4%.')).toEqual([]);
    });

    it('fails a whole number that rounds a decimal figure', () => {
      expect(foreign('16 Commissions had rates near 16.4%.')).toEqual(['foreign-number']);
      expect(foreign('About 8,000 were expected at TSC.')).toEqual(['foreign-number']);
    });

    it('allows an input financial year as a year or FY label, and no other year', () => {
      expect(foreign('In 2025 and FY2025/26, as against 2023/24.')).toEqual(['foreign-number']);
      expect(foreign('In 2025, FY2025/26 and 2025/2026.')).toEqual([]);
      expect(foreign('In 2023.')).toEqual(['foreign-number']);
    });

    it('reads a bare four-digit year as a year, not a count that happens to match', () => {
      const counted = { ...input, totals: { ...input.totals, expected: 2023 } };
      expect(
        narrativeViolations(counted, withParagraph(0, { text: 'In 2023.' })).map(
          (each) => each.kind,
        ),
      ).toEqual(['foreign-number']);
      expect(foreign('Expected: 12,480.')).toEqual([]);
    });

    it('reads an FY label with a hyphen or an en dash', () => {
      expect(foreign('In FY2025-26 and 2024–25.')).toEqual([]);
      expect(foreign('In 2022-23.')).toEqual(['foreign-number']);
    });

    it('reads a range of years as its two years, each an input FY', () => {
      const threeYears = {
        ...input,
        priorYears: [
          ...input.priorYears,
          ...input.priorYears.map((year) => ({ ...year, fy: 2024 })),
        ],
      };
      const ranged = (text: string) =>
        narrativeViolations(threeYears, withParagraph(0, { text })).map((each) => each.kind);

      expect(ranged('Late every year 2024–2026, and in FY2024-2026.')).toEqual([]);
      expect(ranged('Late every year 2023–2026.')).toEqual(['foreign-number']);
      expect(ranged('Late every year 2024–2027, or 2024/27.')).toEqual([
        'foreign-number',
        'foreign-number',
      ]);
    });

    it('fails a derived figure, unless it happens to equal an input figure', () => {
      expect(foreign('Filings fell by 146.')).toEqual(['foreign-number']);
      // 8.2 points equals the prior-year rate of 8.2%: a coincidence the check cannot tell apart.
      expect(foreign('The rate rose by 8.2 percentage points.')).toEqual([]);
    });

    it('treats an Act section number as a number', () => {
      expect(foreign('Under s.31 of the Act.')).toEqual(['foreign-number']);
    });
  });

  describe('citations', () => {
    it('fails an aggregate key the input does not hold, by position, not text', () => {
      const drafted = withParagraph(1, {
        aggregateRefs: ['commission.tsc.nonFilerRate', 'commission.kdf.nonFilerRate', 'national'],
      });

      expect(narrativeViolations(input, drafted)).toEqual([
        { kind: 'unknown-ref', paragraph: 1, index: 1 },
        { kind: 'unknown-ref', paragraph: 1, index: 2 },
      ]);
    });

    it('resolves keys of every figure: national, Commission and prior-year', () => {
      const drafted = withParagraph(0, {
        aggregateRefs: [
          'national.late',
          'national.lateRate',
          'commission.psc.expected',
          'fy2025.national.filed',
          'fy2025.commission.tsc.expected',
        ],
      });

      expect(narrativeViolations(input, drafted)).toEqual([]);
    });

    it('does not resolve a Commission name or a prior year the input does not have', () => {
      const drafted = withParagraph(0, {
        aggregateRefs: [
          'commission.tsc.name',
          'fy2024.national.filed',
          'fy2025.commission.psc.expected',
        ],
      });

      expect(narrativeViolations(input, drafted).map((each) => each.index)).toEqual([0, 1, 2]);
    });

    it('fails a candidate id the input does not hold, by position, not text', () => {
      const drafted = withParagraph(2, { candidateIds: ['threshold-breach:psc:lateRate'] });

      expect(narrativeViolations(input, drafted)).toEqual([
        { kind: 'unknown-candidate', paragraph: 2, index: 0 },
      ]);
    });

    it('fails a finding that cites no candidate; other sections need none', () => {
      const drafted = withParagraph(1, { candidateIds: [] });

      expect(narrativeViolations(input, drafted)).toEqual([
        { kind: 'finding-without-candidate', paragraph: 1 },
      ]);
    });
  });

  describe('sections', () => {
    const [overview, finding, recommendation] = output.paragraphs as [
      NarrateOutput['paragraphs'][number],
      NarrateOutput['paragraphs'][number],
      NarrateOutput['paragraphs'][number],
    ];

    it('fails a paragraph outside the section asked for', () => {
      const drafted = { paragraphs: [finding, recommendation] };

      expect(narrativeViolations({ ...input, section: 'findings' }, drafted)).toEqual([
        { kind: 'wrong-section', paragraph: 1, section: 'recommendations' },
      ]);
    });

    it('fails a draft of one section with no paragraph', () => {
      expect(narrativeViolations({ ...input, section: 'overview' }, { paragraphs: [] })).toEqual([
        { kind: 'missing-section', section: 'overview' },
      ]);
    });

    it('fails a draft of all sections that leaves one out', () => {
      expect(narrativeViolations(input, { paragraphs: [overview, finding] })).toEqual([
        { kind: 'missing-section', section: 'recommendations' },
      ]);
    });

    it('fails a section over its paragraph limit', () => {
      const drafted = {
        paragraphs: [overview, overview, overview, overview, finding, recommendation],
      };

      expect(narrativeViolations(input, drafted)).toEqual([
        { kind: 'too-many-paragraphs', section: 'overview', limit: 3 },
      ]);
    });
  });
});
