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
    ['Signed: Daniel Mutiso Kyalo', 'Daniel Mutiso Kyalo'],
    ['Signatory\nAUMA NAFULA WEKESA', 'AUMA NAFULA WEKESA'],
    ['Witness: Fatuma Abdi Hassan', 'Fatuma Abdi Hassan'],
    ['Lessor: Joseph Kiprop Rono', 'Joseph Kiprop Rono'],
    ['Chargee: Moses Wafula Simiyu', 'Moses Wafula Simiyu'],
    ['Guarantor: Lucy Chebet Koech', 'Lucy Chebet Koech'],
    ['Transferee: Ibrahim Noor Adan', 'Ibrahim Noor Adan'],
    ['Spouse: Janet Moraa Nyaboke', 'Janet Moraa Nyaboke'],
    ['Director: Kevin Otieno Odera', 'Kevin Otieno Odera'],
    ['Mdhamini: Saida Omar Bakari', 'Saida Omar Bakari'],
    ['Mkopaji: Hassan Juma Mwinyi', 'Hassan Juma Mwinyi'],
    ['Dear Wanjiku,', 'Wanjiku'],
  ])('finds the name in %j', (line, name) => {
    const { input } = minimise({ textLayer: line });

    for (const word of name.split(' ').filter(Boolean)) {
      expect(input.textLayer).not.toContain(word);
    }
  });

  it.each([
    [
      'Physical address: House 14, Riverside Drive, Kileleshwa, Nairobi',
      'House 14, Riverside Drive, Kileleshwa, Nairobi',
    ],
    ['Residence: Plot 7, Milimani Estate, Kisumu', 'Plot 7, Milimani Estate, Kisumu'],
    ['Address\nApartment 3B, Ngong Road, Nairobi', 'Apartment 3B, Ngong Road, Nairobi'],
    [
      'Anwani ya makazi: Nyumba 22, Barabara ya Moi, Mombasa',
      'Nyumba 22, Barabara ya Moi, Mombasa',
    ],
  ])('finds the address in %j', (line, address) => {
    const { input } = minimise({ textLayer: line });

    expect(input.textLayer).not.toContain(address);
    expect(input.textLayer).toMatch(/\[\[ADDRESS_1\]\]$/u);
  });

  it.each([
    ['Member No. UW-00781', 'UW-00781'],
    ['Nambari ya uanachama BW-02214', 'BW-02214'],
    ['Payroll No.: KSM/0045123', 'KSM/0045123'],
    ['member no. uw-00781', 'uw-00781'],
  ])('finds the labelled number in %j', (line, number) => {
    const { input, counts } = minimise({ textLayer: line });

    expect(input.textLayer).not.toContain(number);
    expect(counts).toMatchObject({ MEMBER_NUMBER: 1 });
  });

  it('sends a company after a party label as one organisation token, and its role words as they are', () => {
    const minimised = minimise({
      textLayer:
        'Borrower: Tumaini Fresh Produce Limited\nSigned: Kevin Otieno Odera, Branch Manager\nPwani Commercial Bank Limited',
    });

    expect(minimised.input.textLayer).toMatch(/^Borrower: \[\[ORGANISATION_1\]\]\n/u);
    expect(minimised.input.textLayer).toContain('Pwani Commercial Bank Limited');
    expect(minimised.input.textLayer).toContain(', Branch Manager');
    expect(minimised.input.textLayer).not.toContain('Otieno');
    expect(minimised.restore({ debtor: '[[ORGANISATION_1]]' })).toEqual({
      debtor: 'Tumaini Fresh Produce Limited',
    });
  });

  // When a span mixes people, companies and roles, every person's name is minimised: privacy
  // beats readability, so a part that may be a person's name is one.
  it.each([
    ['Signed: Kevin Otieno Odera Sacco Secretary', ['Kevin', 'Otieno', 'Odera']],
    ['Witness: Mary Achieng, Chama Treasurer', ['Mary', 'Achieng']],
    ['Borrower: Wanjiku Njoki Trading Company', ['Wanjiku', 'Njoki']],
    ['Chargors: Jane Wanjiru & Tumaini Holdings Ltd', ['Jane', 'Wanjiru', 'Tumaini']],
    ['Guarantor: Mary Achieng and Upendo Women Group', ['Mary', 'Achieng', 'Upendo']],
    ['Proprietor: Grace Trust', ['Grace']],
    ['Borrower: Peter Kamau Mwangi', ['Peter', 'Kamau', 'Mwangi']],
  ])('sends no person named in %j', (line, names) => {
    const { input } = minimise({ textLayer: line });

    for (const name of names) expect(input.textLayer).not.toContain(name);
  });

  it('keeps an ordinal after a label readable', () => {
    expect(minimise({ textLayer: 'Member number 5th in the register' }).input.textLayer).toBe(
      'Member number 5th in the register',
    );
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
      'Owner PIN shown overleaf',
    ].join('\n');

    expect(minimise({ textLayer: payslip }).input.textLayer).toBe(payslip);
  });
});

/**
 * Review probes of a text layer's names (#314 review rounds 4 and 5): every name word of each row
 * must be minimised. A row per probe, so a change that leaks one again fails here. The long tail
 * (unlabelled names, lowercase names, tables) is #504.
 */
describe('minimise a text layer: review probes', () => {
  it.each([
    // Offices, titles and fillers wherever they sit in a party (F21).
    ['Signed: Director Peter Kamau', 'Peter Kamau'],
    ['Witnessed by: Advocate Jane Wanjiru', 'Jane Wanjiru'],
    ['Witness: Treasurer Mary Wanjiru', 'Mary Wanjiru'],
    ['Signed by: Chairman John Kamau', 'John Kamau'],
    ['Proprietor: the late John Kamau', 'John Kamau'],
    ['Signed: Kevin Otieno Odera Sacco Secretary', 'Kevin Otieno Odera'],
    ['Witness: Mary Achieng, Chama Treasurer', 'Mary Achieng'],
    // Spans end at the next label or a wide gap; a label may be followed by blank lines (F22).
    ['Borrower: John Kamau   Guarantor: Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Borrower: John Kamau\tGuarantor: Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Borrower: John Kamau Guarantor: Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Proprietor:\r\nJohn Kamau', 'John Kamau'],
    ['Proprietor:\n\nJohn Kamau', 'John Kamau'],
    ['Proprietor:\r\n\r\nJohn Kamau Mwangi', 'John Kamau Mwangi'],
    ['Proprietor: John Kamau\nMwangi Njoroge', 'John Kamau Mwangi Njoroge'],
    // Joiners (F23).
    ['Proprietors: John Kamau / Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Proprietors: John Kamau; Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Proprietors: John Kamau or Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Wamiliki: John Kamau na pia Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Wamiliki: John Kamau pamoja na Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Owner: John Kamau c/o Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Owner: Mary Wanjiru w/o John Kamau', 'Mary Wanjiru John Kamau'],
    ['Owner: Peter Kamau s/o John Kamau', 'Peter Kamau John'],
    ['Owner: Grace Njeri d/o John Kamau', 'Grace Njeri John Kamau'],
    ['Owner: John Kamau alias Johnny Kamau', 'John Kamau Johnny'],
    ['Owner: John Kamau aka JK Mwangi', 'John Kamau JK Mwangi'],
    ['Owner: John Kamau t/a Kamau Traders', 'John Kamau Traders'],
    // Mixed people and companies (F17, F24).
    ['Borrower: Wanjiku Njoki Trading Company', 'Wanjiku Njoki Trading'],
    ['Chargors: Jane Wanjiru & Tumaini Holdings Ltd', 'Jane Wanjiru Tumaini'],
    ['Guarantor: Mary Achieng and Upendo Women Group', 'Mary Achieng Upendo Women'],
    ['Proprietor: Grace Trust\nGrace signed the transfer.', 'Grace'],
    ['Borrower: Peter Kamau Mwangi', 'Peter Kamau Mwangi'],
    // Titles in any case, salutations with or without a comma (F25).
    ['MR. JOHN KAMAU', 'JOHN KAMAU'],
    ['Mr.John Kamau', 'John Kamau'],
    ['Rev. Peter Mwangi', 'Peter Mwangi'],
    ['Pastor Grace Wambui', 'Grace Wambui'],
    ['Bishop Samuel Kariuki', 'Samuel Kariuki'],
    ['Sheikh Ali Hassan', 'Ali Hassan'],
    ['Mzee Jomo Kariuki', 'Jomo Kariuki'],
    ['Mama Wanjiru Kamau', 'Wanjiru Kamau'],
    ['Bwana Juma Hamisi', 'Juma Hamisi'],
    ['Bibi Amina Said', 'Amina Said'],
    ['Dkt. Otieno Ouma', 'Otieno Ouma'],
    ['Capt. Daniel Kiprop', 'Daniel Kiprop'],
    ['CPA Mary Atieno', 'Mary Atieno'],
    ['Dear John Kamau', 'John Kamau'],
    ['Mpendwa Halima Ali', 'Halima Ali'],
    ['Ndugu Juma Hamisi,', 'Juma Hamisi'],
    ['Imesainiwa na Juma Hamisi', 'Juma Hamisi'],
    // After a label, every capitalised word to the end of the line or the next label (F31).
    ['Borrower 1: John Kamau', 'John Kamau'],
    ['Borrower (1): John Kamau', 'John Kamau'],
    ['Guarantor(s): John Kamau, Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Proprietor: 1) John Kamau 2) Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Proprietors: 1. John Kamau 2. Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Proprietor: Ali bin Hassan', 'Ali Hassan'],
    ['Proprietor: Fatuma binti Omar', 'Fatuma Omar'],
    ['Proprietor: Kamau wa Ngengi', 'Kamau Ngengi'],
    ['Proprietor: Maria de Souza', 'Maria Souza'],
    ['Proprietor: Pieter van Dijk', 'Pieter Dijk'],
    ['Proprietor: John "Johnny" Kamau', 'John Johnny Kamau'],
    ['Proprietor: John (Johnny) Kamau', 'John Johnny Kamau'],
    ['Proprietor: John Kamau  Mwangi', 'John Kamau Mwangi'],
    ['Signed: Kevin Odera for and on behalf of Pwani Traders', 'Kevin Odera'],
    ['Witness: Mary Wanjiru, a duly authorised officer, Nairobi', 'Mary Wanjiru'],
    ['Proprietor: JOHN KAMAU AND MARY WANJIRU', 'JOHN KAMAU MARY WANJIRU'],
    // A name ending a sentence is the same name bare (F30).
    ['Proprietor: John Kamau.\nKamau signed the transfer.', 'John Kamau'],
  ])('sends no name word of %j', (line, names) => {
    const { input } = minimise({ textLayer: line });

    for (const word of names.split(' ')) {
      expect(input.textLayer).not.toMatch(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'u'));
    }
  });
});

/**
 * A text layer is untrusted input: no label, number or address pattern may take more than linear
 * time over it (#314 review F29). 10,000 spaces after each kind of introducer.
 */
describe('minimise a text layer in linear time', () => {
  const SPACES = ' '.repeat(10_000);
  it.each([
    ['Address', `Address${SPACES}\n`],
    ['Physical address', `Physical address${SPACES}x\n`],
    ['Member No.', `Member No.${SPACES}\n`],
    ['Member No. code', `Member No. ${'A1'.repeat(5_000)}\n`],
    ['Proprietor', `Proprietor${SPACES}\n`],
    ['Proprietor colon', `Proprietor:${SPACES}John\n`],
    ['Guarantor(s)', `Guarantor(s)${SPACES}:\n`],
    ['Mr.', `Mr.${SPACES}\n`],
    ['Dear', `Dear${SPACES}\n`],
    ['certify that', `certify${SPACES}that${SPACES}\n`],
    ['blank lines', `Proprietor:${'\n'.repeat(10_000)}`],
    ['capitalised words', `Proprietor: ${'Kamau '.repeat(5_000)}\n`],
  ])('reads %s and 10,000 more characters quickly', (_name, text) => {
    const started = performance.now();
    minimise({ textLayer: text });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('minimise free text in linear time', () => {
  it.each([
    ['a long run of letters and digits', 'A1'.repeat(10_000)],
    ['a long address-like run', `${'a.'.repeat(5_000)}@${'b.'.repeat(5_000)}`],
  ])('reads %s quickly, and still finds an email', (_name, run) => {
    const started = performance.now();
    const { input } = minimise({ note: `${run} mail jane.doe@example.co.ke` });
    expect(performance.now() - started).toBeLessThan(100);
    expect(input.note).toMatch(/mail \[\[EMAIL_\d\]\]$/u);
  });
});
