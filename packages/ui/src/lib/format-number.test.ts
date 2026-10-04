import { describe, expect, it } from 'vitest';

import { formatNumber, formatPercent } from './format-number';

describe('formatNumber', () => {
  it('groups thousands with commas', () => {
    expect(formatNumber(48312)).toBe('48,312');
    expect(formatNumber(1234567.5)).toBe('1,234,567.5');
  });
});

describe('formatPercent', () => {
  it('shows a percentage to one decimal place at most', () => {
    expect(formatPercent(84)).toBe('84%');
    expect(formatPercent(77.79)).toBe('77.8%');
    expect(formatPercent(1250)).toBe('1,250%');
  });

  it('keeps one decimal place with fixed, so a column of rates lines up', () => {
    expect(formatPercent(90, { fixed: true })).toBe('90.0%');
    expect(formatPercent(77.79, { fixed: true })).toBe('77.8%');
    expect(formatPercent(100, { fixed: true })).toBe('100.0%');
  });
});
