import { describe, expect, it } from 'vitest';

import { formatNumber } from './format-number';

describe('formatNumber', () => {
  it('groups thousands with commas', () => {
    expect(formatNumber(48312)).toBe('48,312');
    expect(formatNumber(1234567.5)).toBe('1,234,567.5');
  });
});
