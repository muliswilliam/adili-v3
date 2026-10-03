import { describe, expect, it } from 'vitest';

import { documentTypeName } from './copy';

describe('documentTypeName', () => {
  it.each([
    ['form-m', 'Form M compliance report'],
    ['compliance-report-receipt', 'Acknowledgement of receipt (Form M)'],
    ['ncr', 'National consolidated report'],
  ])('names the spec 09 type %s', (type, name) => {
    expect(documentTypeName(type)).toBe(name);
  });

  it('reads an unknown type as its words', () => {
    expect(documentTypeName('decision-letter')).toBe('Decision letter');
  });
});
