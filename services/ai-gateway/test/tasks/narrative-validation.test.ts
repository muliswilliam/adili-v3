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

    it('reads a change in percentage points, unsigned', () => {
      expect(foreign('The rate rose by 100 per cent.')).toEqual([]);
    });

    it('strips thousands separators, comma, thin or narrow no-break space', () => {
      expect(foreign('Filed: 11,204, 11\u2009204 and 11\u202f204.')).toEqual([]);
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

    it('fails a derived figure the input does not carry', () => {
      expect(foreign('The rate rose by 8.2 percentage points.')).toEqual([]);
      expect(foreign('Filings fell by 146.')).toEqual(['foreign-number']);
    });

    it('treats an Act section number as a number', () => {
      expect(foreign('Under s.31 of the Act.')).toEqual(['foreign-number']);
    });
  });

  describe('citations', () => {
    it('fails an aggregate key the input does not hold, naming the key', () => {
      const drafted = withParagraph(1, {
        aggregateRefs: ['commission.tsc.nonFilerRate', 'commission.kdf.nonFilerRate', 'national'],
      });

      expect(narrativeViolations(input, drafted)).toEqual([
        { kind: 'unknown-ref', paragraph: 1, ref: 'commission.kdf.nonFilerRate' },
        { kind: 'unknown-ref', paragraph: 1, ref: 'national' },
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

      expect(narrativeViolations(input, drafted).map((each) => each.ref)).toEqual([
        'commission.tsc.name',
        'fy2024.national.filed',
        'fy2025.commission.psc.expected',
      ]);
    });

    it('fails a candidate id the input does not hold', () => {
      const drafted = withParagraph(2, { candidateIds: ['threshold-breach:psc:lateRate'] });

      expect(narrativeViolations(input, drafted)).toEqual([
        { kind: 'unknown-candidate', paragraph: 2, candidate: 'threshold-breach:psc:lateRate' },
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
