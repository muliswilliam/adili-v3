import { describe, expect, it } from 'vitest';

import {
  applicantPhone,
  DETAILS_ERRORS,
  type DetailsInput,
  detailsErrors,
  detailsSchema,
  fieldForPath,
} from './details';

const MERCY: DetailsInput = {
  kind: 'national-id',
  surname: ' Kamau ',
  firstName: 'Mercy',
  otherNames: '',
  number: '2884 1276',
  country: '',
  phone: '0722 418 903',
  email: ' mercy@example.com ',
};

const AMINA: DetailsInput = {
  kind: 'passport',
  surname: 'Okello',
  firstName: 'Amina',
  otherNames: 'Nakato',
  number: 'b 1234567',
  country: 'ug',
  phone: '+256 772 123 456',
  email: 'amina@example.com',
};

describe('detailsSchema', () => {
  it('builds the directory start body for a national ID', () => {
    expect(detailsSchema.parse(MERCY)).toEqual({
      identityDocument: { kind: 'national-id', number: '28841276' },
      names: { surname: 'Kamau', firstName: 'Mercy' },
      phone: '+254722418903',
      email: 'mercy@example.com',
    });
  });

  it('builds it for a passport: number and country upper-cased, any mobile with its code', () => {
    expect(detailsSchema.parse(AMINA)).toEqual({
      identityDocument: { kind: 'passport', number: 'B1234567', country: 'UG' },
      names: { surname: 'Okello', firstName: 'Amina', otherNames: 'Nakato' },
      phone: '+256772123456',
      email: 'amina@example.com',
    });
  });

  it('reports every wrong field at once, in the form words', () => {
    expect(
      detailsErrors({
        ...MERCY,
        surname: '',
        firstName: 'M1',
        number: '2884',
        phone: '0722',
        email: 'mercy@',
      }),
    ).toEqual({
      surname: DETAILS_ERRORS.surname,
      firstName: DETAILS_ERRORS.name,
      number: DETAILS_ERRORS.nationalId,
      phone: DETAILS_ERRORS.kenyanPhone,
      email: DETAILS_ERRORS.email,
    });
  });

  it('asks a passport holder for the issuing country and a number of letters or digits', () => {
    expect(detailsErrors({ ...AMINA, number: 'B1-23', country: '', phone: '772 123' })).toEqual({
      number: DETAILS_ERRORS.passport,
      country: DETAILS_ERRORS.country,
      phone: DETAILS_ERRORS.anyPhone,
    });
  });

  it('accepts names in any script, with apostrophes and hyphens', () => {
    expect(detailsErrors({ ...MERCY, surname: "N'gang'a-Wa Ëlo", firstName: 'Zoë' })).toBeNull();
  });
});

describe('applicantPhone', () => {
  it('takes only Kenyan mobiles from national ID holders', () => {
    expect(applicantPhone('national-id', '254 712 345 678')).toBe('+254712345678');
    expect(applicantPhone('national-id', '+256772123456')).toBeNull();
  });

  it('takes any E.164 mobile from passport holders, and Kenyan ones written locally', () => {
    expect(applicantPhone('passport', '+233 24 471 8265')).toBe('+233244718265');
    expect(applicantPhone('passport', '0712 345 678')).toBe('+254712345678');
    expect(applicantPhone('passport', '772123456')).toBeNull();
  });
});

describe('fieldForPath', () => {
  it('maps the directory field paths to the form fields', () => {
    expect(fieldForPath('identityDocument.number')).toBe('number');
    expect(fieldForPath('names.otherNames')).toBe('otherNames');
    expect(fieldForPath('phone')).toBe('phone');
    expect(fieldForPath('somethingElse')).toBeNull();
  });
});
