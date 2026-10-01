import { describe, expect, it } from 'vitest';

import { esc, formatDate, formatDateTime } from '../../src/issuance/templates/page.js';

describe('document formatting', () => {
  it('writes dates with three-letter months, calendar dates as they are', () => {
    expect(formatDate('2027-11-01')).toBe('1 Nov 2027');
    expect(formatDate('2026-09-02')).toBe('2 Sep 2026');
  });

  it('writes instants in Kenyan time', () => {
    expect(formatDateTime('2027-11-15T07:42:00Z')).toBe('15 Nov 2027, 10:42 EAT');
    // 22:30 UTC is already the next day in Nairobi.
    expect(formatDate(new Date('2026-09-30T22:30:00Z'))).toBe('1 Oct 2026');
    expect(formatDateTime('2026-09-30T21:05:00Z')).toBe('1 Oct 2026, 00:05 EAT');
  });

  it('escapes markup in rendered values', () => {
    expect(esc(`<b>"O'Brien" & co</b>`)).toBe(
      '&lt;b&gt;&quot;O&#39;Brien&quot; &amp; co&lt;/b&gt;',
    );
  });
});
