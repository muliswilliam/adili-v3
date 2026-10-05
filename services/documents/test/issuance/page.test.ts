import { describe, expect, it } from 'vitest';

import {
  attestation,
  CONTENT_STYLES,
  kes,
  originalAmount,
} from '../../src/issuance/templates/declaration-content.js';
import { restrictedVerifyNote } from '../../src/issuance/templates/letter.js';
import {
  esc,
  footerDocument,
  formatDate,
  formatDateTime,
  htmlDocument,
  verificationPanel,
  watermarked,
  watermarkText,
} from '../../src/issuance/templates/page.js';

const WATERMARK = {
  recipientName: 'Amina Otieno',
  reference: 'ARQ-PSC-2026-0000012-H',
  date: '2026-10-01',
};

describe('the watermark', () => {
  it('names the recipient, the request reference and the date', () => {
    expect(watermarkText(WATERMARK)).toBe(
      'Issued to Amina Otieno · ARQ-PSC-2026-0000012-H · 1 Oct 2026',
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

describe('verificationPanel', () => {
  it('names the document, gives its code and says what the check shows', () => {
    const panel = verificationPanel(
      'package',
      'ADL-7Q4K-M2XR',
      'The check shows only whether the package is valid.',
    );
    expect(panel).toContain('Check that this package is genuine');
    expect(panel).toContain('<div class="vcode mono nw">ADL-7Q4K-M2XR</div>');
    expect(panel).toContain('The check shows only whether the package is valid.');
  });
});

describe('attestation', () => {
  it('keeps the solemn declaration and when it was made on one page', () => {
    const html = attestation({
      attestation: {
        text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
        declaredAt: '2026-10-02T14:23:00.000Z',
      },
    });
    expect(html).toMatch(/^<section class="sec attest">/);
    expect(CONTENT_STYLES).toContain('.attest{break-inside:avoid}');
  });
});

describe('Swahili documents (#592)', () => {
  const footer = {
    verificationId: 'ADL-7KQ2-M4XP',
    verifyUrl: 'https://verify.adili.example/d/ADL-7KQ2-M4XP',
    issuerName: 'Public Service Commission',
    issuedAt: new Date('2026-10-05T08:00:00.000Z'),
    reference: 'CLR-PSC-2026-0000087-0',
    version: null,
  };

  it('prints the verification footer in Swahili', async () => {
    const html = await footerDocument({ ...footer, language: 'sw' });
    expect(html).toContain('<html lang="sw">');
    expect(html).toContain('<b>Hakiki hati hii</b> kwenye verify.adili.example kwa msimbo');
    expect(html).toContain(
      'Imetolewa na Public Service Commission kupitia Adili Online tarehe 5 Oktoba 2026',
    );
    expect(html).toContain('Kumb. <b class="nw">CLR-PSC-2026-0000087-0</b>');
    expect(html).toContain(
      'Ukurasa <span class="pageNumber"></span> kati ya <span class="totalPages"></span>',
    );
    expect(html).not.toContain('Check this document');
  });

  it('keeps the English footer by default', async () => {
    const html = await footerDocument(footer);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<b>Check this document</b>');
    expect(html).toContain('Page <span class="pageNumber"></span> of');
  });

  it('dates the signature in Swahili', () => {
    expect(formatDateTime('2026-10-05T08:00:00.000Z', 'sw')).toBe('5 Oktoba 2026, 11:00 EAT');
  });

  it('names the document the verification note is about in Swahili', () => {
    expect(restrictedVerifyNote('ADL-1', 'letter', 'sw')).toContain('kwamba barua hii ni halali');
    expect(restrictedVerifyNote('ADL-1', 'receipt', 'sw')).toContain('kwamba risiti hii ni halali');
    expect(restrictedVerifyNote('ADL-1', 'report', 'sw')).toContain('kwamba hati hii ni halali');
  });

  it("declares the document's language", () => {
    expect(htmlDocument('t', '', '<p>x</p>', 'sw')).toContain('<html lang="sw">');
    expect(htmlDocument('t', '', '<p>x</p>')).toContain('<html lang="en">');
  });
});
