import { describe, expect, it } from 'vitest';

import { safeReturnTo } from './return-to.ts';

describe('safeReturnTo', () => {
  it.each([
    ['/declarations?cycle=2027#household', '/declarations?cycle=2027#household'],
    ['/', '/'],
  ])('keeps the relative path %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'declarations',
    '//evil.example/path',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
  ])('falls back to / for %s', (input) => {
    expect(safeReturnTo(input)).toBe('/');
  });
});
