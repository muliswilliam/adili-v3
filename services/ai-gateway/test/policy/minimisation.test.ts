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

  it("replaces amounts in a declarant's question and history, and nowhere else (spec 11)", () => {
    const minimised = minimise({
      question: 'Is KES 3 million right for my car, or KSh 2,500,000? I earn 120k bob a month.',
      history: [
        { role: 'user', text: 'Je, shilingi milioni 3 ni sawa? Au Sh. 250,000?' },
        { role: 'assistant', text: 'A loan of 1,200,000 shillings is a liability.' },
      ],
      passages: [{ id: 'p-1', text: 'A gift above KES 20,000 is declared.' }],
      note: 'Paid KES 1500000.',
    });

    expect(minimised.input).toEqual({
      question: 'Is [[AMOUNT_4]] right for my car, or [[AMOUNT_5]]? I earn [[AMOUNT_6]] a month.',
      history: [
        { role: 'user', text: 'Je, [[AMOUNT_1]] ni sawa? Au [[AMOUNT_2]]?' },
        { role: 'assistant', text: 'A loan of [[AMOUNT_3]] is a liability.' },
      ],
      passages: [{ id: 'p-1', text: 'A gift above KES 20,000 is declared.' }],
      note: 'Paid KES 1500000.',
    });
    expect(minimised.counts).toEqual({ AMOUNT: 6 });
    expect(minimised.restore('You wrote [[AMOUNT_4]].')).toBe('You wrote KES 3 million.');
  });

  it("leaves years, counts, dates and section numbers of a declarant's question readable", () => {
    const question =
      'Is my 2015 car declared? I have 2 children, the statement date is 1 November 2025, and s.31(4) says 30 days.';
    expect(minimise({ question }).input.question).toBe(question);
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

  it('finds a known phone number written with +254 or 0, under the same token (review N18)', () => {
    const minimised = minimise({
      phone: '+254 712 345 678',
      note: 'Call 0712 345 678, 0712-345678, +254712345678 or 254 712 345 678; not 0712 345 679.',
    });

    expect(minimised.input).toEqual({
      phone: '[[PHONE_1]]',
      note: 'Call [[PHONE_1]], [[PHONE_1]], [[PHONE_1]] or [[PHONE_1]]; not [[PHONE_2]].',
    });
    expect(minimised.restore({ text: '[[PHONE_1]]' })).toEqual({ text: '+254 712 345 678' });
    // A phone field without digits stays a word, not a pattern that matches anything.
    expect(minimise({ phone: 'none', note: 'Call none of 0712 345 678.' }).input).toEqual({
      phone: '[[PHONE_1]]',
      note: 'Call [[PHONE_1]] of [[PHONE_2]].',
    });
    // And the other way round: a field in the national form, text in the international one.
    expect(minimise({ phone: '0712345678', note: 'On +254 712 345 678.' }).input).toEqual({
      phone: '[[PHONE_1]]',
      note: 'On [[PHONE_1]].',
    });
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

/**
 * A document's text layer (spec 05b S10): no field says what is a name there, so names are found
 * by what labels them on the page, then replaced wherever they recur.
 */
describe('minimise a text layer', () => {
  const TITLE_DEED = [
    'TITLE DEED',
    'Title Number: NAKURU/NJORO/1187',
    'Approximate Area: 0.405 Ha',
    'Proprietor: WANJIRU AKINYI KAMAU, ID No. 28765432, of P.O. Box 1022-20100, Nakuru',
    'Registered on 12 March 2019 in the name of Wanjiru Akinyi Kamau.',
  ].join('\n');

  it('replaces labelled names, IDs, parcels and addresses, wherever they recur', () => {
    const { input } = minimise({ textLayer: TITLE_DEED });

    for (const identifier of [
      'WANJIRU',
      'Wanjiru',
      'AKINYI',
      'Kamau',
      '28765432',
      'NAKURU/NJORO/1187',
      'P.O. Box 1022-20100',
    ]) {
      expect(input.textLayer).not.toContain(identifier);
    }
    expect(input.textLayer).toContain('Approximate Area: 0.405 Ha');
    expect(input.textLayer).toContain('Registered on 12 March 2019 in the name of');
  });

  it('restores what the model copies from the tokens', () => {
    const minimised = minimise({ textLayer: TITLE_DEED });
    const owner = /Proprietor: (\[\[PERSON_\d+\]\] \[\[PERSON_\d+\]\] \[\[PERSON_\d+\]\])/u.exec(
      minimised.input.textLayer,
    )?.[1];
    const parcel = /Title Number: (\[\[PARCEL_\d+\]\])/u.exec(minimised.input.textLayer)?.[1];

    expect(minimised.restore({ coOwner: owner, parcelNumber: parcel })).toEqual({
      coOwner: 'WANJIRU AKINYI KAMAU',
      parcelNumber: 'NAKURU/NJORO/1187',
    });
  });

  it.each([
    ['Employee Name: Brian Otieno Ouma', 'Brian Otieno Ouma'],
    ['Registered Owner: GRACE NJERI MUTUA', 'GRACE NJERI MUTUA'],
    ['Account name: Peter Kiprono', 'Peter Kiprono'],
    ['Dear Mr. Kiprono,', 'Kiprono'],
    ['Received from Dr Achieng Odhiambo', 'Achieng Odhiambo'],
    ['Jina: Halima Mohamed Ali', 'Halima Mohamed Ali'],
    ['This is to certify that ESTHER WAIRIMU NDUNG’U is the registered holder', 'ESTHER WAIRIMU'],
    ['NAME\nJOSEPH MWANGI KARIUKI', 'JOSEPH MWANGI KARIUKI'],
    ['Proprietors: JOSEPH MWANGI and ESTHER WAIRIMU', 'JOSEPH MWANGI ESTHER WAIRIMU'],
    ['Wamiliki: Juma Hassan na Amina Said', 'Juma Hassan Amina Said'],
    ['Mwanachama: Rehema Achieng Otieno', 'Rehema Achieng Otieno'],
  ])('finds the name in %j', (line, name) => {
    const { input } = minimise({ textLayer: line });

    for (const word of name.split(' ').filter(Boolean)) {
      expect(input.textLayer).not.toContain(word);
    }
  });

  it('keeps the words that join two names readable', () => {
    const { input } = minimise({
      textLayer: 'Proprietors: JOSEPH MWANGI and ESTHER WAIRIMU\nLand and buildings',
    });

    expect(input.textLayer).toMatch(/^Proprietors: \[\[PERSON_\d\]\] \[\[PERSON_\d\]\] and /u);
    expect(input.textLayer).toContain('Land and buildings');
  });

  it('leaves labelled names in other text alone: only a document is read this way', () => {
    expect(minimise({ note: 'Name: Brian Otieno' }).input.note).toBe('Name: Brian Otieno');
  });

  it('leaves the labels and values a reading needs', () => {
    const payslip = [
      'Employer: Ministry of Health',
      'Designation: Senior Nursing Officer',
      'Basic Salary 98,400.00',
      'Gross Pay 142,650.00',
      'Make: TOYOTA',
      'Model: FIELDER',
      'Member No. UW-00781',
      'Owner PIN shown overleaf',
    ].join('\n');

    expect(minimise({ textLayer: payslip }).input.textLayer).toBe(payslip);
  });
});
