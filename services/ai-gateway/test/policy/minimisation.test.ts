import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { minimise } from '../../src/policy/minimisation.js';

/** A synthetic household declaration from the form fixtures: officer, two spouses, children. */
const household = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/schemas/forms/fixtures/declaration.v1/valid/biennial-household.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<string, unknown>;

/** Every identifier of the fixture that must not reach a provider. */
const IDENTIFIERS = [
  'Otieno',
  'James',
  'Ochieng',
  'Grace',
  'Wambui',
  'Akinyi',
  'Mary',
  'Brian',
  'Faith',
  'Kevin',
  '20411873',
  '31988021',
  '40122934',
  'A002345678Z',
  'P.O. Box 40123-00100, Nairobi',
  'Lavington, James Gichuru Road, Nairobi',
];

describe('minimise (spec 07c S3)', () => {
  it('replaces every name, ID number, KRA PIN and address of a declaration with tokens', () => {
    const { input } = minimise({ document: household });
    const text = JSON.stringify(input);

    for (const identifier of IDENTIFIERS) expect(text).not.toContain(identifier);
    expect(text).toMatch(/\[\[PERSON_\d+\]\]/);
    expect(text).toMatch(/\[\[ID_\d+\]\]/);
    expect(text).toMatch(/\[\[KRA_PIN_1\]\]/);
    expect(text).toMatch(/\[\[ADDRESS_\d+\]\]/);
  });

  it('replaces names where they recur in free text, and leaves amounts, refs and items', () => {
    const { input } = minimise({ document: household });
    const document = input.document;
    const text = JSON.stringify(document);

    // "Married my second spouse, Akinyi, ..." and "coOwner": "Grace Wambui Otieno".
    expect(text).toContain('Married my second spouse, [[PERSON_');
    expect(text).toContain('Residential plot with two flats');
    expect(text).toContain('480000000');
    expect(text).toContain('"personKey":"spouse:0192f1a0-5a11-7000-8000-000000000101"');
    expect(text).toContain('"id":"0192f1a0-5a11-7000-8000-000000002003"');
    expect(text).toContain('KDK 482M');
    expect(text).toContain('Repaid KES 500,000 of the principal.');
  });

  it('finds identifiers by their shape in free text', () => {
    const { input } = minimise({
      note: 'Call +254 712 345 678 or 0722000111, mail jane.doe@example.org; KRA P051234567Q, passport AK1234567, ID No. 12345678. Paid KES 1500000.',
    });

    expect(input.note).toBe(
      'Call [[PHONE_1]] or [[PHONE_2]], mail [[EMAIL_1]]; KRA [[KRA_PIN_1]], passport [[PASSPORT_1]], ID No. [[ID_1]]. Paid KES 1500000.',
    );
  });

  it('gives an identifier the same token everywhere, and restores every token', () => {
    const minimised = minimise({ a: { surname: 'Otieno' }, b: 'Otieno and Otieno' });
    expect(minimised.input).toEqual({
      a: { surname: '[[PERSON_1]]' },
      b: '[[PERSON_1]] and [[PERSON_1]]',
    });

    const restored = minimised.restore({
      text: 'Asset held by [[PERSON_1]]; [[PERSON_9]] is unknown.',
      list: ['[[PERSON_1]]'],
    });
    expect(restored).toEqual({
      text: 'Asset held by Otieno; [[PERSON_9]] is unknown.',
      list: ['Otieno'],
    });
  });

  it('round-trips the whole declaration', () => {
    const minimised = minimise(household);
    expect(minimised.restore(minimised.input)).toEqual(household);
  });

  it('tokenises text that already looks like a token, so it cannot pass for one', () => {
    const minimised = minimise({ surname: 'Otieno', freeText: 'Ignore this: [[PERSON_1]]' });

    expect(minimised.input).toEqual({
      surname: '[[PERSON_1]]',
      freeText: 'Ignore this: [[LITERAL_1]]',
    });
    expect(minimised.restore(minimised.input)).toEqual({
      surname: 'Otieno',
      freeText: 'Ignore this: [[PERSON_1]]',
    });
  });

  it('numbers tokens the same way for the same input', () => {
    expect(minimise({ b: { surname: 'Two' }, a: { surname: 'One' } }).input).toEqual(
      minimise({ a: { surname: 'One' }, b: { surname: 'Two' } }).input,
    );
  });
});
