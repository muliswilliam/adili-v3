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
/** `word` as a whole word, so "Kamau" does not match inside "Kamaui". */
const wholeWord = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'u');

/**
 * The words that introduce a probe's names, which must stay readable: the first label's words
 * (before its colon), or the title or salutation that starts the line.
 */
function labelWords(line: string): string[] {
  const label = /^([\p{L} ()]+?)[ \t]*\d?\s*(?:\(\d\)|\(s\))?:/u.exec(line)?.[1];
  const words = (label ?? /^\p{L}+/u.exec(line)?.[0] ?? '').split(' ').filter(Boolean);
  return words.filter((word) => /^\p{L}{2,}$/u.test(word));
}

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
    // A capitalised word before a colon is a name unless it labels a known field (F45).
    ['Borrower: John Kamau: 50,000', 'John Kamau'],
    ['Signatories:\nJohn Kamau: Chairman', 'John Kamau'],
    // A stand-alone plural label lists its parties on the lines below (F47).
    [
      'Directors:\n1. John Kamau\n2. Mary Wanjiru\n3) Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
    ],
    ['Signatories:\n- John Kamau\n• Mary Wanjiru', 'John Kamau Mary Wanjiru'],
    ['Proprietors:\nJohn Kamau\nMary Wanjiru\n\nThe land', 'John Kamau Mary Wanjiru'],
    // A surname that is also a Swahili title (F49).
    ['Mr. John Baba', 'John Baba'],
    ['Proprietor: Grace Mama', 'Grace Mama'],
    // Recurrences in any case (F48).
    ['Proprietor: John Kamau\nsigned: john kamau', 'John Kamau john kamau'],
    ['Proprietor: John Kamau\nJOHN kamau', 'John Kamau JOHN kamau'],
    // Shapes are blanked line by line, whatever ends a line (F44).
    ['Tel 0712 345 678\vMember No. AB12C\fProprietor: John Kamau', 'John Kamau AB12C'],
    // A name ending a sentence is the same name bare (F30).
    ['Proprietor: John Kamau.\nKamau signed the transfer.', 'John Kamau'],
  ])('sends no name word of %j, and keeps its label readable', (line, names) => {
    const { input } = minimise({ textLayer: line });

    for (const word of names.split(' ')) expect(input.textLayer).not.toMatch(wholeWord(word));
    for (const word of labelWords(line)) expect(input.textLayer).toMatch(wholeWord(word));
  });
});

/**
 * Milliseconds of CPU `run` takes: the fastest of three runs. CPU time, not the wall clock, so
 * other processes on a busy machine (a CI runner) do not count; the fastest, as a run is only
 * ever slowed (by garbage collection), never sped.
 */
function fastest(run: () => void): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = process.cpuUsage();
    run();
    const { user, system } = process.cpuUsage(started);
    best = Math.min(best, (user + system) / 1_000);
  }
  return best;
}

/** Below this many milliseconds, a run's time is noise, not a cost to compare. */
const NOISE_MS = 20;

/**
 * Asserts that reading grows linearly with its input, on a machine of any speed: `read` over the
 * input `build` makes at `scale` twice is timed against it at `scale`, after a warm-up. Linear
 * time about doubles; quadratic time quadruples, so the bound is three times (with a floor for
 * runs too fast to time). The input is built before the clock starts.
 */
function expectLinear<T>(build: (scale: number) => T, read: (input: T) => void, scale: number) {
  read(build(Math.max(1, Math.floor(scale / 10))));
  const once = build(scale);
  const twice = build(scale * 2);
  const onceMs = fastest(() => {
    read(once);
  });
  const twiceMs = fastest(() => {
    read(twice);
  });
  expect(
    twiceMs,
    `${twiceMs.toFixed(1)} ms at twice the input, ${onceMs.toFixed(1)} ms once`,
  ).toBeLessThan(3 * Math.max(onceMs, NOISE_MS));
}

/** Time enough for the slowest rows, read six times on a slow runner. */
const LINEAR_TIMEOUT_MS = 60_000;

/**
 * A text layer is untrusted input: no label, number or address pattern may take more than linear
 * time over it (#314 review F29, F36, F37 and later): long runs after each kind of introducer,
 * repeated introducers, and stray line terminators in an address line. Each row builds its input
 * at a scale (about half the 10,000 to 100,000 characters it was first written at) and is read
 * at that scale and twice it.
 */
describe('minimise a text layer in linear time', () => {
  const spaces = (scale: number) => ' '.repeat(scale);
  it.each<[string, (scale: number) => string, number]>([
    ['Address', (n) => `Address${spaces(n)}\n`, 5_000],
    ['Physical address', (n) => `Physical address${spaces(n)}x\n`, 5_000],
    ['Member No.', (n) => `Member No.${spaces(n)}\n`, 5_000],
    ['Member No. code', (n) => `Member No. ${'A1'.repeat(n)}\n`, 2_500],
    ['Proprietor', (n) => `Proprietor${spaces(n)}\n`, 5_000],
    ['Proprietor colon', (n) => `Proprietor:${spaces(n)}John\n`, 5_000],
    ['Guarantor(s)', (n) => `Guarantor(s)${spaces(n)}:\n`, 5_000],
    ['Mr.', (n) => `Mr.${spaces(n)}\n`, 5_000],
    ['Dear', (n) => `Dear${spaces(n)}\n`, 5_000],
    ['certify that', (n) => `certify${spaces(n)}that${spaces(n)}\n`, 5_000],
    ['blank lines', (n) => `Proprietor:${'\n'.repeat(n)}`, 5_000],
    ['capitalised words', (n) => `Proprietor: ${'Kamau '.repeat(n)}\n`, 2_500],
    // Repeated introducers, each followed by the rest of a long line (F36).
    ['Mr repeated', (n) => 'Mr '.repeat(n), 16_500],
    ['Dear repeated', (n) => 'Dear '.repeat(n), 10_000],
    ['Borrower repeated', (n) => 'Borrower '.repeat(n), 5_500],
    ['Guarantor(s): repeated', (n) => 'Guarantor(s): '.repeat(n), 3_500],
    ['Proprietor: and commas', (n) => `Proprietor: ${', '.repeat(n)}`, 25_000],
    // Stray line terminators inside an address line (F37).
    ['Address and carriage returns', (n) => `Address${' \r'.repeat(n)}`, 10_000],
    ['Address and line separators', (n) => `Address${' \u2028'.repeat(n)}`, 10_000],
    ['Address and paragraph separators', (n) => `Address${' \u2029'.repeat(n)}`, 10_000],
    [
      'a long address',
      (n) => `Physical address: ${'House 14, Riverside Drive, '.repeat(n)}`,
      2_000,
    ],
    ['Make: A repeated', (n) => 'Make: A '.repeat(n), 6_250],
    ['Chairman: repeated', (n) => 'Chairman: '.repeat(n), 5_000],
    ['a marked list', (n) => `Directors:\n${'(a) John Kamau\n'.repeat(n)}`, 3_500],
    ['shapes after a name', (n) => `Witness: Jane Akinyi Tel ${'0712 345 678 '.repeat(n)}`, 4_000],
    ['a long list', (n) => `Directors:\n${'1. John Kamau\n'.repeat(n)}`, 3_500],
    ['Kamau: repeated', (n) => `Borrower: ${'Kamau: '.repeat(n)}`, 7_000],
    ['newlines', (n) => `Proprietor:${'\n'.repeat(n)}John Kamau`, 50_000],
    // A long run of capitals, which a parcel's section may start (F102).
    ['capitals', (n) => 'KRA '.repeat(n), 12_500],
    // Capitals joined by slashes, which a parcel's blocks may be (F111).
    ['capitals and slashes', (n) => 'KSM/BLOCK '.repeat(n), 5_000],
    // Member numbers, each a label's value a name may follow (F115).
    ['member numbers', (n) => 'Member No. 1 '.repeat(n), 3_850],
  ])(
    'reads %s in linear time',
    (_name, build, scale) => {
      expectLinear(build, (textLayer) => minimise({ textLayer }), scale);
    },
    LINEAR_TIMEOUT_MS,
  );
});

/**
 * Both directions at once (#314 review rounds 7 to 9): each row's names must not reach the
 * request, and its fields' labels and values must stay readable, so a change cannot fix one side
 * by breaking the other.
 */
describe('minimise a text layer: names out, fields readable', () => {
  it.each([
    // Field labels and values after a name, on the same line (F39, F51).
    [
      'Employee Name: John Kamau Gender: Male Nationality: Kenyan Occupation: Teacher',
      'John Kamau',
      'Employee Name Gender Male Nationality Kenyan Occupation Teacher',
    ],
    [
      'Employee Name: Mary Wanjiru Grade: M Basic Salary: 45,000',
      'Mary Wanjiru',
      'Grade Basic Salary 45,000',
    ],
    [
      'Borrower: John Kamau KES 12,500,000 Total Shares 500',
      'John Kamau',
      'KES 12,500,000 Total Shares 500',
    ],
    [
      'Borrower: John Kamau Purpose: Development Value: KES 3,000,000',
      'John Kamau',
      'Purpose Development Value KES 3,000,000',
    ],
    [
      'Proprietor: John Kamau Village: Kiamumbi Ward: Kahawa',
      'John Kamau',
      'Village Kiamumbi Ward Kahawa',
    ],
    [
      'Proprietor: John Kamau Parcel: Plot 7 Use: Agricultural',
      'John Kamau',
      'Parcel Plot Use Agricultural',
    ],
    ['Borrower: John Kamau Term: 36 Months', 'John Kamau', 'Term 36 Months'],
    [
      'Registered Owner: BRIAN OUMA Make: TOYOTA Model: FIELDER',
      'BRIAN OUMA',
      'Make TOYOTA Model FIELDER',
    ],
    [
      'Account Name: Mary Wanjiru Account Type: Savings Branch: Nyali',
      'Mary Wanjiru',
      'Account Type Savings Branch Nyali',
    ],
    [
      'Proprietor: Peter Kamau Section: Njoro Station: Molo',
      'Peter Kamau',
      'Section Njoro Station Molo',
    ],
    // A name before a colon goes on when an office or an amount follows (F45, F51).
    ['Borrower: John Kamau: 50,000', 'John Kamau', 'Borrower 50,000'],
    ['Signatories:\nJohn Kamau: Chairman', 'John Kamau', 'Signatories Chairman'],
    ['Witness: Mary Achieng: Branch Manager', 'Mary Achieng', 'Witness Branch Manager'],
    // Fields with no name at all stay as they are.
    ['Gender: Male', '', 'Gender Male'],
    ['Basic Salary: 45,000', '', 'Basic Salary 45,000'],
    ['Total Shares: 500', '', 'Total Shares 500'],
    ['Loan Term: 36 Months', '', 'Loan Term 36 Months'],
    ['KES 12,500,000', '', 'KES 12,500,000'],
    [
      'Bank Name: Highlands Bank Kenya PLC Branch Name: Nyali',
      '',
      'Bank Name Highlands Branch Nyali',
    ],
    ['Employer Name: Ministry of Health', '', 'Employer Name Ministry Health'],
    ['Business Name: Tumaini Traders', '', 'Business Name Tumaini Traders'],
    // A list under a stand-alone label: names out, offices and the text after it readable (F52).
    [
      'Directors:\n1. John Kamau, Chairman\n2. Mary Wanjiru, Secretary',
      'John Kamau Mary Wanjiru',
      'Directors Chairman Secretary',
    ],
    [
      'Directors:\na) John Kamau\nb) Mary Wanjiru\n\nc) Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'Directors',
    ],
    ['Signatories:\ni. John Kamau\nii. Mary Wanjiru', 'John Kamau Mary Wanjiru', 'Signatories'],
    [
      'Signatories:\n\u2013 John Kamau\n\u2013 Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Signatories',
    ],
    [
      'Proprietors:\nJohn Kamau\nMary Wanjiru\n\nThe land is freehold',
      'John Kamau Mary Wanjiru',
      'The land is freehold',
    ],
    [
      'Directors:\n1. John Kamau\n2. Date: 12 May 2026\nBalance: KES 500',
      'John Kamau',
      'Date May Balance KES 500',
    ],
    [
      'Directors:\n1. John Kamau\n2. Gender Male\n3. Total Shares 500',
      'John Kamau',
      'Gender Male Total Shares 500',
    ],
    // A colon ends a name only after a field word; after a name it goes on (F57).
    ['Guarantor: Peter Otieno: ID 12345678', 'Peter Otieno', 'Guarantor ID'],
    ['Director: John Kamau: 12345678', 'John Kamau', 'Director'],
    ['Witness: Jane Akinyi: Tel 0712 345 678', 'Jane Akinyi', 'Witness Tel'],
    ['Borrower: John Kamau:\nChairman', 'John Kamau', 'Borrower Chairman'],
    ['Borrower: John Kamau: Sh 50,000', 'John Kamau', 'Borrower Sh 50,000'],
    ['Borrower: John Kamau: Shs 50,000 UGX 10 TZS 20', 'John Kamau', 'Shs UGX TZS'],
    // A field word before a colon is a label, even straight after a name (F58).
    ['Borrower: John Kamau Loan Amount: KES 50,000', 'John Kamau', 'Loan Amount KES 50,000'],
    ['Borrower: John Kamau Amount: 50,000', 'John Kamau', 'Amount 50,000'],
    ['Proprietor: John Kamau Value: 3,000,000', 'John Kamau', 'Value 3,000,000'],
    ['Employee Name: Mary Wanjiru Basic Salary: 45,000', 'Mary Wanjiru', 'Basic Salary 45,000'],
    ['Employee Name: Mary Wanjiru Salary: 45,000', 'Mary Wanjiru', 'Salary 45,000'],
    [
      'Employee Name: Mary Wanjiru Net Pay: 38,000 Gross Pay: 45,000',
      'Mary Wanjiru',
      'Net Pay Gross Pay 38,000 45,000',
    ],
    // A list goes on past an entry that does not read as a name; each entry's names are out (F59).
    [
      'Directors:\n1. John Kamau\n2. Mary Wanjiru: Secretary\n3. Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'Directors Secretary',
    ],
    [
      'Directors:\n1. John Kamau 500 shares\n2. Mary Wanjiru 60%\n3. Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'shares',
    ],
    [
      'Directors:\n1. John Kamau, appointed 12 May 2020\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'appointed',
    ],
    [
      'Directors:\n1. John Kamau: 500 shares\n2. Mary Wanjiru: 50,000\n3. Peter Otieno: ID 12345678',
      'John Kamau Mary Wanjiru Peter Otieno',
      'shares ID',
    ],
    ['Directors:\n1. Grace Wanjiru\n2. Faith Akinyi', 'Grace Wanjiru Faith Akinyi', 'Directors'],
    ['Shareholders:\n1. Tumaini Traders Ltd\n2. John Kamau', 'John Kamau', 'Shareholders'],
    [
      'Officials:\n- Chairman: John Kamau\n- Treasurer: Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Chairman Treasurer',
    ],
    // More list markers (F62).
    ['Directors:\n(a) John Kamau\n(b) Mary Wanjiru', 'John Kamau Mary Wanjiru', 'Directors'],
    ['Directors:\n(1) John Kamau\n(2) Mary Wanjiru', 'John Kamau Mary Wanjiru', 'Directors'],
    ['Directors:\n(i) John Kamau\n(ii) Mary Wanjiru', 'John Kamau Mary Wanjiru', 'Directors'],
    ['Directors:\n[1] John Kamau\n[2] Mary Wanjiru', 'John Kamau Mary Wanjiru', 'Directors'],
    ['Directors:\n1 John Kamau\n2 Mary Wanjiru', 'John Kamau Mary Wanjiru', 'Directors'],
    // Field, organisation, place and office words before a colon are labels (F63).
    [
      'Proprietor: John Kamau Bank: Equity Bank Branch: Nyali',
      'John Kamau',
      'Bank Equity Branch Nyali',
    ],
    [
      'Director: John Kamau Company: Tumaini Traders Ltd',
      'John Kamau',
      'Company Tumaini Traders Ltd',
    ],
    [
      'Owner: John Kamau Vehicle: Toyota Premio Description: Saloon',
      'John Kamau',
      'Vehicle Toyota Premio Description Saloon',
    ],
    [
      'Owner: John Kamau Manufacturer: Toyota Registry: Nakuru',
      'John Kamau',
      'Manufacturer Toyota Registry Nakuru',
    ],
    [
      'Proprietor: John Kamau Residence: Njoro Constituency: Molo Sub-County: Njoro',
      'John Kamau',
      'Residence Njoro Constituency Molo Sub-County',
    ],
    [
      'Employee Name: Mary Wanjiru Ministry: Health Organisation: Kenya Red Cross',
      'Mary Wanjiru',
      'Ministry Health Organisation Red Cross',
    ],
    ['Proprietor: John Kamau Nature of Title: Freehold', 'John Kamau', 'Nature of Title Freehold'],
    ['Proprietor: John Kamau Nakuru: Njoro', 'John Kamau', 'Nakuru Njoro'],
    ['Witness: Mary Wanjiru Sacco: Ufanisi', 'Mary Wanjiru', 'Sacco Ufanisi'],
    // A false hit does not spread to other cases (F63).
    [
      'Proprietor: John Kamau Nyali Branch\nThe nyali branch and NYALI BRANCH accounts.',
      'John Kamau',
      'branch BRANCH',
    ],
    ['Borrower: John Kamau Group\nThe group and its GROUP savings.', 'John Kamau', 'group GROUP'],
    // A list ends at an unmarked line that is no wrapped name (F64).
    ['Directors:\n1. John Kamau\nAssets\nLand in Njoro', 'John Kamau', 'Assets Land Njoro'],
    [
      'Directors:\n1. John Kamau\nSecurity Offered\nShare Capital',
      'John Kamau',
      'Security Offered Share Capital',
    ],
    [
      'Proprietors:\n1. John Kamau\nSchedule\nRegistered Office',
      'John Kamau',
      'Schedule Registered Office',
    ],
    ['Guarantors:\n1. John Kamau\nTERMS AND CONDITIONS', 'John Kamau', 'TERMS AND CONDITIONS'],
    ['Owners:\n1. John Kamau\nToyota Premio', 'John Kamau', 'Toyota Premio'],
    [
      'Signatories:\n1. John Kamau\nEquity Bank Nyali Branch',
      'John Kamau',
      'Equity Bank Nyali Branch',
    ],
    ['Proprietors:\n1. John Kamau\nKiambu County Land', 'John Kamau', 'Kiambu County Land'],
    [
      'Directors:\n1. John\nKamau Mwangi\n2. Mary Wanjiru',
      'John Kamau Mwangi Mary Wanjiru',
      'Directors',
    ],
    // A field word without a colon goes on as a name when more name words follow (F65).
    ['Borrower: John Kamau Ward Otieno', 'John Kamau Ward Otieno', 'Borrower'],
    ['Borrower: John Kamau ID 12345678', 'John Kamau', 'ID'],
    // A list entry is a name then a comma or dash and an office or field (F68).
    [
      'Directors:\nJohn Kamau, Chairman\nMary Wanjiru, Secretary',
      'John Kamau Mary Wanjiru',
      'Directors Chairman Secretary',
    ],
    [
      'Directors:\nJohn Kamau - Chairman\nMary Wanjiru - Treasurer\nPeter Otieno, Director',
      'John Kamau Mary Wanjiru Peter Otieno',
      'Chairman Treasurer',
    ],
    // A field word ends a span without a colon, unless it is also a name and a name follows (F69).
    ['Owner: John Kamau Make Toyota Model Premio', 'John Kamau', 'Make Toyota Model Premio'],
    ['Proprietor: John Kamau County Kiambu', 'John Kamau', 'County Kiambu'],
    ['Employee Name: Mary Wanjiru Station Nyeri', 'Mary Wanjiru', 'Station Nyeri'],
    ['Proprietor: John Kamau Tenure Freehold', 'John Kamau', 'Tenure Freehold'],
    ['Employee Name: Mary Wanjiru Employer Kenya Power', 'Mary Wanjiru', 'Employer Kenya Power'],
    [
      'Account Name: Mary Wanjiru Bank Equity Bank Branch Nyali',
      'Mary Wanjiru',
      'Bank Equity Branch Nyali',
    ],
    ['Lessee: Peter Kamau Pwani Commercial Bank Limited', 'Peter Kamau', 'Lessee'],
    [
      'Borrower: John Kamau Facility Overdraft Interest Rate 13%',
      'John Kamau',
      'Facility Overdraft Interest Rate',
    ],
    // A list ends when numbering restarts, or at a line that is no wrapped name (F70).
    [
      'Directors:\n1. John Kamau\n2. Mary Wanjiru\n1. Collateral: Title deed',
      'John Kamau Mary Wanjiru',
      'Collateral Title deed',
    ],
    ['Directors:\n1. John Kamau\nCollateral', 'John Kamau', 'Collateral'],
    ['Directors:\n1. John Kamau\nVehicles', 'John Kamau', 'Vehicles'],
    ['Directors:\n1. John Kamau\nMotor Vehicles', 'John Kamau', 'Motor Vehicles'],
    ['Directors:\n1. JOHN KAMAU\nPROPERTIES', 'JOHN KAMAU', 'PROPERTIES'],
    ['Directors:\n1. John Kamau\nShareholding', 'John Kamau', 'Shareholding'],
    // Markers compare only with their own kind and indent; an initial is no marker (F73).
    ['Directors:\n1. J. Kamau\n2. A. Otieno', 'Kamau Otieno', 'Directors'],
    ['Directors:\nJ. Kamau\nA. Otieno', 'Kamau Otieno', 'Directors'],
    [
      'Directors:\n1. John Kamau\na. Chairman\nb. Holds 500 shares\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Directors Chairman',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Toyota Premio\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Directors',
    ],
    [
      'Directors:\n1. John Kamau\n   1. ID 12345678\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Directors ID',
    ],
    [
      'Directors:\n1. John Kamau\n2. Mary Wanjiru\n2. Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'Directors',
    ],
    [
      'Directors:\n1. John Kamau\n2. Mary Wanjiru\n1. Peter Otieno\n2. Jane Akinyi',
      'John Kamau Mary Wanjiru Peter Otieno Jane Akinyi',
      'Directors',
    ],
    // A line between two entries numbered in turn is a wrapped name (F74).
    [
      'Directors:\n1. John Kamau\nMwangi\n2. Mary Wanjiru',
      'John Kamau Mwangi Mary Wanjiru',
      'Directors',
    ],
    [
      'Directors:\n1. John Kamau\nCollateral\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Collateral',
    ],
    // After a blank line, an entry must read as a name (F75).
    ['Directors:\n1. John Kamau\n\nKenya Power, Bank', 'John Kamau', 'Kenya Power Bank'],
    ['Directors:\n1. John Kamau\n\n2. Kenya Power, Bank', 'John Kamau', 'Kenya Power Bank'],
    // A marked line of another kind or indent is read only if it reads as a name (F77).
    [
      'Directors:\n1. John Kamau\n(a) Toyota Premio\nMake: Toyota\nModel: Premio\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Toyota Premio Make Model',
    ],
    [
      'Directors:\n1. John Kamau\nb. Box 123 Nakuru\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Box Nakuru',
    ],
    [
      'Directors:\n1. John Kamau\n(b) Plot 7 Njoro\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Plot Njoro',
    ],
    [
      'Shareholders:\n1. John Kamau\na) Tumaini Holdings Ltd - Ordinary Shares\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Tumaini Holdings Ltd Ordinary Shares',
    ],
    [
      'Directors:\n1. John Kamau\na) Kenya Power\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Kenya Power',
    ],
    [
      'Directors:\n1. John Kamau\nEquity Bank, Nakuru Branch\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Equity Bank Nakuru Branch',
    ],
    [
      'Directors:\n1. John Kamau\na) Peter Otieno\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'Directors',
    ],
    // An office before a name on an unmarked line (F78).
    [
      'Directors:\nChairman John Kamau\nSecretary Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Chairman Secretary',
    ],
    [
      'Directors:\nJohn Kamau\nSecretary Mary Wanjiru\nTreasurer Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'Secretary Treasurer',
    ],
    // A sub-entry is a name when its leading words are; the rest is read as a span (F81).
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno ID 12345678\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'ID',
    ],
    [
      'Directors:\n1. John Kamau\n(b) Peter Otieno - 40%\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      '40',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno PIN A012345678Z\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'PIN',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno Tel 0712 345 678\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'Tel',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno 0712345678\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'Directors',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno - 500 shares\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      '500 shares',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno KES 500,000\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'KES 500,000',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno, Nakuru\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'Nakuru',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno - Son\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'Son',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno (Son)\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'Son',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Peter Otieno born 1990\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'born 1990',
    ],
    [
      'Directors:\n1. John Kamau\n   2. Peter Otieno ID 12345678\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'ID',
    ],
    [
      'Directors:\n1. John Kamau\n- Peter Otieno ID 12345678\n2. Mary Wanjiru',
      'John Kamau Peter Otieno Mary Wanjiru',
      'ID',
    ],
    [
      'Directors:\ni. John Kamau\nii. Mary Wanjiru\niii. Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'Directors',
    ],
    // A sub-item one word leads is an item, not a name; a company word marks an organisation (F83).
    [
      'Directors:\n1. John Kamau\n(a) Equity Bank, Nakuru Branch\n2. Mary Wanjiru\nBank: Equity Bank',
      'John Kamau Mary Wanjiru',
      'Equity Bank Nakuru Branch',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Freehold Tenure\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Freehold Tenure',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Barclays Bank\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Barclays Bank',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Unity Sacco\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Unity Sacco',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Co-operative Bank\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Co-operative Bank',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Ordinary Shares\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Ordinary Shares',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Preference Shares 200\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Preference Shares 200',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Freehold/Leasehold Nakuru/Njoro/123\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Freehold Leasehold Nakuru Njoro',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Residential Plot 4\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Residential Plot 4',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Current Account\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Current Account',
    ],
    [
      'Directors:\n1. John Kamau\n(a) Premio Year 2015\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Premio Year 2015',
    ],
    [
      'Directors:\n1. John Kamau\n- Equity Bank\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'Equity Bank',
    ],
    // Box is a field word only in an address (F84).
    ['Proprietor: John Box', 'John Box', 'Proprietor'],
    [
      'Directors:\n1. John Kamau\n(a) Peter Box Otieno\n2. Mary Wanjiru',
      'John Kamau Peter Box Otieno Mary Wanjiru',
      'Directors',
    ],
    ['Directors:\n1. John Kamau\n2. Peter Box', 'John Kamau Peter Box', 'Directors'],
    [
      'Directors:\n1. John Kamau\n(a) Wanjiru ID 12345678\n2. Mary Wanjiru',
      'John Kamau Wanjiru Mary Wanjiru',
      'ID',
    ],
    [
      'Directors:\n1. John Kamau\n(a) J. Kamau ID 12345678\n2. Mary Wanjiru',
      'John Kamau Mary Wanjiru',
      'ID',
    ],
    // "i." starts a roman list when "ii." comes next (F81).
    [
      'Directors:\ni. John Kamau\nID 12345678\nii. Mary Wanjiru\nID 23456789\niii. Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'ID',
    ],
    [
      'Directors:\n(i) John Kamau\nPIN A012345678Z\n(ii) Mary Wanjiru\nPIN A012345679Z\n(iii) Peter Otieno',
      'John Kamau Mary Wanjiru Peter Otieno',
      'PIN',
    ],
    // Common words a name holds stay readable in prose (F48, F55).
    [
      'Proprietor: Grace Baba\nThe baba and the mama of the house; tel and shares; total value.',
      'Grace Baba',
      'baba mama tel shares total value',
    ],
  ])('in %j sends no name of %j and keeps %j readable', (line, names, readable) => {
    const { input } = minimise({ textLayer: line });

    for (const word of names.split(' ').filter(Boolean)) {
      expect(input.textLayer).not.toMatch(wholeWord(word));
    }
    for (const word of readable.split(' ')) expect(input.textLayer).toMatch(wholeWord(word));
  });
});

describe('minimise a text layer: what is no name', () => {
  it(
    'reads pages in linear time (F49)',
    () => {
      const pagesOf = (count: number) =>
        Array.from({ length: count }, (_, page) => ({
          page: page + 1,
          textLayer: 'Proprietor: John Kamau\nMember No. AB12C\nPhysical address: House 14, Nakuru',
        }));
      expectLinear(pagesOf, (pages) => minimise({ document: { pages } }), 500);
    },
    LINEAR_TIMEOUT_MS,
  );

  it('reads a label at the end of one page and its name at the start of the next (F38)', () => {
    const { input } = minimise({
      document: {
        pages: [
          { page: 1, textLayer: 'TRANSFER OF LAND\nProprietor:' },
          { page: 2, textLayer: 'John Kamau Mwangi\nof Nakuru' },
        ],
      },
    });

    expect(JSON.stringify(input)).not.toMatch(/John|Kamau|Mwangi/u);
  });

  it.each([
    // Another field on the same line ends the span: its value is the reading's (F39).
    ['Registered Owner: BRIAN OUMA Make: TOYOTA Model: FIELDER', 'BRIAN OUMA', 'TOYOTA FIELDER'],
    [
      'Account Name: Mary Wanjiru Account Type: Savings Branch: Nyali',
      'Mary Wanjiru',
      'Savings Nyali',
    ],
    ['Proprietor: Peter Kamau Section: Njoro Station: Molo', 'Peter Kamau', 'Njoro Molo'],
    // A place, office or company on the line below is no part of the name.
    ['Proprietor: John Kamau\nNakuru', 'John Kamau', 'Nakuru'],
    ['Signed: Kevin Odera\nBranch Manager', 'Kevin Odera', 'Branch Manager'],
    [
      'Lessee: Peter Kamau\nPwani Commercial Bank Limited',
      'Peter Kamau',
      'Pwani Commercial Bank Limited',
    ],
  ])('in %j minimises %j and leaves %j', (line, names, fields) => {
    const { input } = minimise({ textLayer: line });

    for (const word of names.split(' ')) expect(input.textLayer).not.toContain(word);
    for (const word of fields.split(' ')) expect(input.textLayer).toContain(word);
  });

  it.each([
    // A name label after an organisation or field word is that field's (F46).
    ['Bank Name: Highlands Bank Kenya PLC Branch Name: Nyali', 'Highlands Nyali'],
    ['Employer Name: Ministry of Health', 'Ministry Health'],
    ['Business Name: Tumaini Traders', 'Tumaini Traders'],
  ])('in %j keeps %j readable', (line, fields) => {
    const { input } = minimise({ textLayer: line });

    for (const word of fields.split(' ')) expect(input.textLayer).toContain(word);
  });

  it('reads a labelled account number as an account number (F49)', () => {
    expect(minimise({ textLayer: 'Account Number: 0712 345 678 9' }).input.textLayer).toBe(
      'Account Number: [[ACCOUNT_1]]',
    );
    expect(minimise({ textLayer: 'A/C No. 4521' }).input.textLayer).toBe('A/C No. [[ACCOUNT_1]]');
  });

  it('keeps a page header readable after a label at the foot of the page before (F49)', () => {
    const { input } = minimise({
      document: {
        pages: [
          { page: 1, textLayer: 'Proprietor: John Kamau\nWitness:' },
          { page: 2, textLayer: 'TITLE DEED\nPage 2' },
        ],
      },
    });

    expect(JSON.stringify(input)).toContain('TITLE DEED');
  });

  it('sends an email that holds a name as one email token, restored exactly (F67)', () => {
    const minimised = minimise({
      textLayer: 'Proprietor: John Kamau\nContact John.Kamau@KamauLaw.co.ke or 0712 345 678',
    });

    expect(minimised.input.textLayer).toBe(
      'Proprietor: [[PERSON_1]] [[PERSON_2]]\nContact [[EMAIL_1]] or [[PHONE_1]]',
    );
    expect(minimised.restore({ email: '[[EMAIL_1]]' })).toEqual({
      email: 'John.Kamau@KamauLaw.co.ke',
    });
  });

  it('reads a list numbered again after a page break (F73)', () => {
    const { input } = minimise({
      document: {
        pages: [
          { page: 1, textLayer: 'Directors:\n1. John Kamau\n2. Mary Wanjiru' },
          { page: 2, textLayer: '1. Peter Otieno\n2. Jane Akinyi' },
        ],
      },
    });

    expect(JSON.stringify(input)).not.toMatch(/John|Kamau|Mary|Wanjiru|Peter|Otieno|Jane|Akinyi/u);
  });

  it('reads a private-use mark already in a text layer as a space (F71)', () => {
    const { input } = minimise({ textLayer: 'Proprietor: John\ue000Kamau' });

    expect(input.textLayer).not.toMatch(/John|Kamau/u);
  });

  it('matches a name a page gives only in the cases a page writes it in', () => {
    const { input } = minimise({
      textLayer: 'Borrower: Tumaini Fresh Produce Limited\nTUMAINI FRESH sells fresh produce.',
    });

    expect(input.textLayer).not.toMatch(/Tumaini|TUMAINI|Fresh|FRESH/u);
    expect(input.textLayer).toContain('sells fresh produce.');
  });
});

/**
 * The parcel scan (F111) finds what the regular expression it replaced found, on random runs of
 * capitals, digits, letters and marks: the expression is the reference, too slow for long runs.
 */
describe('minimise free text: parcels as the regular expression found them', () => {
  const REFERENCE =
    /(?<![\p{L}\p{N}/])\p{Lu}{2,}(?:[ .]\p{Lu}+)*(?:\/[\p{Lu}\p{N}]+(?:[ .][\p{Lu}\p{N}]+)*)*\/\d+(?![\p{L}\p{N}/])/gu;
  const PARTS = ['AB', 'CD', 'E', 'x', 'eF', '1', '23', ' ', ' ', '/', '/', '.', ',', '-'];

  it('matches the reference on 20,000 random runs', () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const differences: string[][] = [];
    for (let run = 0; run < 20_000; run++) {
      const text = Array.from({ length: 1 + random(12) }, () => PARTS[random(PARTS.length)]).join(
        '',
      );
      const sent = minimise({ note: text }).input.note.replace(/\[\[PARCEL_\d+\]\]/gu, '#');
      // Another shape's token (an ID of digits) is no parcel's business.
      if (sent.includes('[[')) continue;
      const expected = text.replace(REFERENCE, '#');
      if (sent !== expected) differences.push([text, expected, sent]);
    }
    expect(differences).toEqual([]);
  });
});

describe('minimise free text in linear time', () => {
  it.each<[string, (scale: number) => string, number]>([
    ['a long run of letters and digits', (n) => 'A1'.repeat(n), 5_000],
    ['a long address-like run', (n) => `${'a.'.repeat(n)}@${'b.'.repeat(n)}`, 2_500],
  ])(
    'reads %s in linear time, and still finds an email',
    (_name, run, scale) => {
      const noteOf = (n: number) => `${run(n)} mail jane.doe@example.co.ke`;
      expectLinear(noteOf, (note) => minimise({ note }), scale);
      expect(minimise({ note: noteOf(scale) }).input.note).toMatch(/mail \[\[EMAIL_\d\]\]$/u);
    },
    LINEAR_TIMEOUT_MS,
  );

  it(
    'reads a long run of capitals in linear time, and still finds a parcel (F102)',
    () => {
      const noteOf = (n: number) => `${'KRA '.repeat(n)}plot NAKURU/NJORO/1234`;
      expectLinear(noteOf, (note) => minimise({ note }), 12_500);
      expect(minimise({ note: noteOf(12_500) }).input.note).toMatch(/plot \[\[PARCEL_\d\]\]$/u);
    },
    LINEAR_TIMEOUT_MS,
  );

  it('finds an email whose domain an OCR pass broke ("jane@.example.co.ke")', () => {
    expect(minimise({ note: 'mail jane@.example.co.ke' }).input.note).toBe('mail [[EMAIL_1]]');
  });
});
