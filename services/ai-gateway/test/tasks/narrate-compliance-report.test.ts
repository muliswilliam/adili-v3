import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { narrateComplianceReport } from '../../src/tasks/narrate-compliance-report.js';
import { narrateInput } from '../support/inputs.js';

describe('narrate-compliance-report input', () => {
  const parseInput = (changes: object) =>
    narrateComplianceReport.input.safeParse({ ...narrateInput, ...changes });

  it('refuses findings or all with no candidate, which no draft could pass', () => {
    for (const section of ['findings', 'all']) {
      const parsed = parseInput({ candidates: [], section });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['candidates']]);
    }
  });

  it('accepts overview or recommendations with no candidate', () => {
    for (const section of ['overview', 'recommendations']) {
      expect(parseInput({ candidates: [], section }).success).toBe(true);
    }
  });

  it("takes a candidate's values as reporting.yaml's PatternCandidate allows them", () => {
    const contract = parse(
      readFileSync(
        createRequire(import.meta.url).resolve('@adili/schemas/internal/reporting.yaml'),
        'utf8',
      ),
    ) as object;
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(contract, 'reporting.yaml');
    const patternCandidate = ajv.compile({
      $ref: 'reporting.yaml#/components/schemas/PatternCandidate',
    });
    const [candidate] = narrateInput.candidates;
    const withValues = (values: unknown) => ({ ...candidate, values });

    for (const values of [
      { from: 0.082, to: 0.164, basis: 'fy2025', missing: null },
      { years: [2024, 2025, 2026] },
      { flagged: true },
      { nested: { rate: 0.1 } },
    ]) {
      const reporting = patternCandidate(withValues(values));
      const gateway = parseInput({ candidates: [withValues(values)] }).success;

      expect({ values, gateway }).toEqual({ values, gateway: reporting });
    }
  });
});
