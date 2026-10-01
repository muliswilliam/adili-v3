import { describe, expect, it } from 'vitest';

import { kes, originalAmount } from '../../src/issuance/templates/declaration-content.js';
import {
  esc,
  formatDate,
  formatDateTime,
  htmlDocument,
  watermarked,
  watermarkText,
} from '../../src/issuance/templates/page.js';

const WATERMARK = {
  recipientName: 'Amina Otieno',
  reference: 'ARQ-PSC-2026-0000012-5',
  date: '2026-10-01',
};

describe('the watermark', () => {
  it('names the recipient, the request reference and the date', () => {
    expect(watermarkText(WATERMARK)).toBe(
      'Issued to Amina Otieno · ARQ-PSC-2026-0000012-5 · 1 Oct 2026',
    );
  });

  it('lays a fixed layer over the whole body, which Chromium prints on every page', () => {
    const html = watermarked(htmlDocument('T', '', '<p>Body</p>'), WATERMARK);
    expect(html).toMatch(/<p>Body<\/p><style>[^<]*\.wm\{position:fixed;inset:0;/);
    expect(html).toMatch(/<\/div><\/body><\/html>$/);
    expect(html.split('Issued to Amina Otieno').length - 1).toBeGreaterThan(1);
  });

  it('escapes the recipient name', () => {
    const html = watermarked(htmlDocument('T', '', ''), {
      ...WATERMARK,
      recipientName: '<script>x</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('refuses a document without a body rather than issue it unmarked', () => {
    expect(() => watermarked('<p>no body</p>', WATERMARK)).toThrow(/body/);
  });
});

describe('amounts', () => {
  it('writes shillings with cents, and a foreign amount in its own minor units', () => {
    expect(kes({ kesCents: 123_456_789 })).toBe('KES 1,234,567.89');
    expect(
      originalAmount({ kesCents: 1, original: { currency: 'USD', minorUnits: 1_000_000 } }),
    ).toBe('USD 10,000.00');
    expect(
      originalAmount({ kesCents: 1, original: { currency: 'JPY', minorUnits: 150_000 } }),
    ).toBe('JPY 150,000');
    expect(originalAmount({ kesCents: 1 })).toBeNull();
  });
});

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
