import { CLR, DCI, format } from '@adili/numbering/references';
import { describe, expect, it } from 'vitest';

import {
  type ClarificationLetterInput,
  clarificationLetterV1,
} from '../../src/issuance/templates/clarification-letter.v1.js';

/** The payload as review sends it, before the template's defaults. */
const payload = (dueAt: string): ClarificationLetterInput => ({
  declarantName: 'John Kamau Otieno',
  commission: { name: 'Teachers Service Commission', issuerCode: 'TSC' },
  declarationReference: format(DCI, { issuer: 'TSC', period: 2026, sequence: 3418 }),
  clarificationReference: format(CLR, { issuer: 'TSC', period: 2026, sequence: 871 }),
  items: [
    {
      label: 'Liabilities · John Kamau Otieno',
      requirementLabel: 'Provide the omitted information',
      text: 'Please declare the loan balance.',
    },
  ],
  issuedAt: '2026-09-14T06:20:00.000Z',
  dueAt,
  portalUrl: 'http://localhost:3010/clarifications/0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c10',
});

const context = {
  verificationId: 'ADL-TEST',
  issuedAt: new Date('2026-09-14T06:20:00.000Z'),
  signerName: 'Adili Online Signing',
};

// Issuance parses the payload before rendering it (issuance.service.ts).
const render = (dueAt: string) =>
  clarificationLetterV1.render(clarificationLetterV1.payload.parse(payload(dueAt)), context);

/** The letter as the review service sends it (`ClarificationLetterPayload`), then rendered. */
const renderWith = (fields: Record<string, unknown>) =>
  clarificationLetterV1.render(
    clarificationLetterV1.payload.parse({ ...payload('2026-10-14T06:20:00.000Z'), ...fields }),
    context,
  );

describe('clarification-letter.v1', () => {
  it("Q9: gives the reply window the due date was set with, the Commission's policy", () => {
    expect(render('2026-10-14T06:20:00.000Z')).toContain(
      'You have 30 days from receipt of this letter to respond (section 35(3)).',
    );
    // A Commission whose policy gives 45 days.
    const longer = render('2026-10-29T06:20:00.000Z');
    expect(longer).toContain('Respond by 29 Oct 2026');
    expect(longer).toContain('You have 45 days from receipt of this letter');
    expect(longer).not.toContain('30 days');
  });

  describe('#592: AI assistance, opening and language', () => {
    it('says the letter was drafted with AI help when aiAssisted', () => {
      const html = renderWith({ aiAssisted: true });
      expect(html).toContain(
        'Parts of this letter were drafted with the help of AI and checked and approved by the Commission officer who issued it.',
      );
      expect(renderWith({ aiAssisted: false })).not.toContain('drafted with the help of AI');
    });

    it('marks each item drafted with AI', () => {
      const html = renderWith({
        aiAssisted: true,
        items: [
          {
            label: 'Assets',
            requirementLabel: 'Correct the entry',
            text: 'One.',
            aiAssisted: true,
          },
          {
            label: 'Income',
            requirementLabel: 'Correct the entry',
            text: 'Two.',
            aiAssisted: false,
          },
        ],
      });
      expect(html.match(/AI-assisted draft/g)).toHaveLength(1);
    });

    it('marks no item that does not say it was drafted with AI', () => {
      const html = renderWith({
        aiAssisted: true,
        items: [{ label: 'Assets', requirementLabel: 'Correct the entry', text: 'One.' }],
      });
      expect(html).not.toContain('AI-assisted draft');
    });

    it('passes its language to the page footer and the document', () => {
      const sw = clarificationLetterV1.payload.parse({
        ...payload('2026-10-14T06:20:00.000Z'),
        language: 'sw',
      });
      expect(clarificationLetterV1.footer(sw).language).toBe('sw');
      expect(renderWith({ language: 'sw' })).toContain('<html lang="sw">');
    });

    it('prints the opening paragraph before the items, escaped', () => {
      const html = renderWith({ opening: 'We thank you for filing <on time>.' });
      expect(html).toContain('<p class="opening">We thank you for filing &lt;on time&gt;.</p>');
      expect(html.indexOf('class="opening"')).toBeLessThan(html.indexOf('class="items"'));
      expect(renderWith({ opening: null })).not.toContain('class="opening"');
    });

    it("prints a Swahili letter's own text and dates in Swahili", () => {
      const html = renderWith({ language: 'sw', aiAssisted: true });
      expect(html).toContain('Ombi la ufafanuzi');
      expect(html).toContain('Jibu kufikia 14 Oktoba 2026');
      expect(html).toContain('Jinsi ya kujibu');
      expect(html).toContain('Wako mwaminifu,');
      expect(html).toContain('>Kumb.<');
      expect(html).toContain('>Tarehe<');
      expect(html).toContain('Sehemu za barua hii ziliandikwa kwa msaada wa AI');
      expect(html).not.toContain('How to respond');
      expect(html).not.toContain('Yours faithfully');
    });

    it('keeps the English letter as it was', () => {
      const html = renderWith({ language: 'en' });
      expect(html).toContain('How to respond');
      expect(html).toContain('Respond by 14 Oct 2026');
      expect(html).toContain('Yours faithfully,');
    });

    it('takes a payload from before these fields as an English letter without AI note', () => {
      const parsed = clarificationLetterV1.payload.parse(payload('2026-10-14T06:20:00.000Z'));
      expect(parsed).toMatchObject({ language: 'en', opening: null, aiAssisted: false });
    });
  });
});
