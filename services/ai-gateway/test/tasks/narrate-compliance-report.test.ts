import { describe, expect, it } from 'vitest';

import { narrateComplianceReport } from '../../src/tasks/narrate-compliance-report.js';
import { narrateInput } from '../support/inputs.js';

describe('narrate-compliance-report input', () => {
  const parse = (changes: object) =>
    narrateComplianceReport.input.safeParse({ ...narrateInput, ...changes });

  it('refuses findings or all with no candidate, which no draft could pass', () => {
    for (const section of ['findings', 'all']) {
      const parsed = parse({ candidates: [], section });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['candidates']]);
    }
  });

  it('accepts overview or recommendations with no candidate', () => {
    for (const section of ['overview', 'recommendations']) {
      expect(parse({ candidates: [], section }).success).toBe(true);
    }
  });
});
