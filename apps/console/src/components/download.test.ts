import { describe, expect, it } from 'vitest';

import { attachmentFileName } from './download';

describe('attachmentFileName', () => {
  it('reads quoted and bare file names', () => {
    expect(attachmentFileName('attachment; filename="adili-roster-template.xlsx"', 'x')).toBe(
      'adili-roster-template.xlsx',
    );
    expect(attachmentFileName('attachment; filename=roster.csv', 'x')).toBe('roster.csv');
  });

  it('falls back without a file name', () => {
    expect(attachmentFileName(null, 'fallback.csv')).toBe('fallback.csv');
    expect(attachmentFileName('attachment', 'fallback.csv')).toBe('fallback.csv');
  });
});
