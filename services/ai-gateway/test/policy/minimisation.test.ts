import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { minimise, UnknownTokenError } from '../../src/policy/minimisation.js';

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
  'PF-2003-001184',
  'KISUMU/MUNICIPALITY BLOCK 7/412',
  'KDK 482M',
  'KDK482M',
  '1974-03-12',
  '2004-06-02',
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
    expect(text).toContain('"creditor":"[[PARTY_');
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

  it('replaces debtors, creditors, file numbers, parcels, registrations and file names whole', () => {
    const { input } = minimise({
      employment: { personnelFileNumber: 'PF-2003-001184' },
      assets: [
        {
          details: {
            parcelNumber: 'KSM/BLOCK 4/88',
            registration: 'KCA 123B',
            debtor: 'John Kamau',
          },
        },
      ],
      liabilities: [{ creditor: 'Equity Bank Kenya' }],
      attachments: [{ fileName: 'logbook-KCA123B.pdf' }],
      note: 'John Kamau still owes me; see KSM/BLOCK 4/88.',
    });

    expect(input).toEqual({
      employment: { personnelFileNumber: '[[FILE_NUMBER_1]]' },
      assets: [
        {
          details: {
            debtor: '[[PARTY_1]]',
            parcelNumber: '[[PARCEL_1]]',
            registration: '[[REGISTRATION_1]]',
          },
        },
      ],
      liabilities: [{ creditor: '[[PARTY_2]]' }],
      attachments: [{ fileName: '[[FILE_NAME_1]]' }],
      note: '[[PARTY_1]] still owes me; see [[PARCEL_1]].',
    });
  });

  it('finds addresses, registrations, parcels and unlabelled national IDs in free text', () => {
    const { input } = minimise({
      note: 'Write to P.O. Box 501-00200, Nairobi or Sanduku la Posta 77. Car KBZ 901A, plot NAIROBI/BLOCK 82/1190. Her ID 28765432, his 31234567; kitambulisho 2233445.',
    });

    expect(input.note).toBe(
      'Write to [[ADDRESS_1]] or [[ADDRESS_2]]. Car [[REGISTRATION_1]], plot [[PARCEL_1]]. Her ID [[ID_1]], his [[ID_3]]; kitambulisho [[ID_2]].',
    );
  });

  it('leaves amounts, percentages and longer codes readable', () => {
    const text =
      'Paid KES 1500000 and KSh 2500000, USD 1200000, 12,345,678 shillings, 3.1234567, 12345678%, group 12345678-aaaa.';
    expect(minimise({ note: text }).input.note).toBe(text);
  });

  it('finds a known name in any case, under the same token (review M1)', () => {
    const minimised = minimise({
      surname: 'Wanjiru',
      note: "WANJIRU said wanjiru-s plot is Wanjiru's.",
    });

    expect(minimised.input).toEqual({
      surname: '[[PERSON_1]]',
      note: "[[PERSON_1]] said [[PERSON_1]]-s plot is [[PERSON_1]]'s.",
    });
    expect(minimised.restore({ text: 'By [[PERSON_1]].' })).toEqual({ text: 'By Wanjiru.' });
  });

  it('finds a known ID number written with spaces or dashes (review M1)', () => {
    const minimised = minimise({
      nationalId: '28765432',
      kraPin: 'A002345678Z',
      note: 'ID 2876 5432, also 28-765-432; PIN a002 345 678z.',
    });

    expect(minimised.input).toEqual({
      kraPin: '[[KRA_PIN_1]]',
      nationalId: '[[ID_1]]',
      note: 'ID [[ID_1]], also [[ID_1]]; PIN [[KRA_PIN_1]].',
    });
    expect(minimised.restore({ text: '[[ID_1]]' })).toEqual({ text: '28765432' });
  });

  it('replaces dates and places of birth, and bank account numbers in free text (review Q14)', () => {
    const minimised = minimise({
      birth: { date: '1974-03-12', place: 'Kisumu' },
      children: [{ dateOfBirth: '2004-06-02' }],
      note: 'Born 1974-03-12 in Kisumu. Salary paid to account 01234567890123 and 0123 4567 8901; acquired 2004-06-02.',
    });

    expect(minimised.input).toEqual({
      birth: { date: '[[BIRTH_DATE_1]]', place: '[[BIRTH_PLACE_1]]' },
      children: [{ dateOfBirth: '[[BIRTH_DATE_2]]' }],
      note: 'Born [[BIRTH_DATE_1]] in [[BIRTH_PLACE_1]]. Salary paid to account [[ACCOUNT_1]] and [[ACCOUNT_2]]; acquired [[BIRTH_DATE_2]].',
    });
    expect(minimised.restore(minimised.input)).toEqual({
      birth: { date: '1974-03-12', place: 'Kisumu' },
      children: [{ dateOfBirth: '2004-06-02' }],
      note: 'Born 1974-03-12 in Kisumu. Salary paid to account 01234567890123 and 0123 4567 8901; acquired 2004-06-02.',
    });
  });

  it('refuses to restore a token the input never had', () => {
    const minimised = minimise({ surname: 'Otieno' });

    expect(() => minimised.restore({ text: '[[PERSON_1]] and [[PERSON_2]]' })).toThrow(
      UnknownTokenError,
    );
    expect(() => minimised.restore({ text: '[[ID_1]]' })).toThrow(UnknownTokenError);
    expect(minimised.restore({ text: '[[PERSON_1]]' })).toEqual({ text: 'Otieno' });
  });

  it('gives an identifier the same token everywhere, and restores every token', () => {
    const minimised = minimise({ a: { surname: 'Otieno' }, b: 'Otieno and Otieno' });
    expect(minimised.input).toEqual({
      a: { surname: '[[PERSON_1]]' },
      b: '[[PERSON_1]] and [[PERSON_1]]',
    });

    const restored = minimised.restore({
      text: 'Asset held by [[PERSON_1]].',
      list: ['[[PERSON_1]]'],
    });
    expect(restored).toEqual({ text: 'Asset held by Otieno.', list: ['Otieno'] });
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
