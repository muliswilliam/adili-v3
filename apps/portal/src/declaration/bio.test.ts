import { describe, expect, it } from 'vitest';

import { BIO_MESSAGES, bioIssues } from './bio';

const complete = {
  birth: { date: '1980-04-02', place: 'Nyeri' },
  maritalStatus: 'married' as const,
  address: { postal: 'P.O. Box 12-10100, Nyeri', physical: 'Ruringu estate, Nyeri' },
  employment: { nature: 'permanent' as const },
};

describe('bio rules', () => {
  it('passes a complete bio', () => {
    expect(bioIssues(complete, '2027-11-01', 'biennial')).toEqual({});
  });

  it('asks for every missing answer with the spec copy', () => {
    const issues = bioIssues({}, '2027-11-01', 'biennial');
    expect(
      Object.fromEntries(Object.entries(issues).map(([key, value]) => [key, value.message])),
    ).toEqual({
      birthDate: BIO_MESSAGES.birthDate,
      birthPlace: BIO_MESSAGES.birthPlace,
      maritalStatus: BIO_MESSAGES.maritalStatus,
      postal: BIO_MESSAGES.postal,
      physical: BIO_MESSAGES.physical,
      nature: BIO_MESSAGES.nature,
    });
    expect(issues.birthDate?.kind).toBe('missing');
  });

  it('needs an age of 18 to 100 on the statement date', () => {
    expect(
      bioIssues(
        { ...complete, birth: { ...complete.birth, date: '2009-11-02' } },
        '2027-11-01',
        'biennial',
      ).birthDate,
    ).toEqual({ kind: 'invalid', message: BIO_MESSAGES.birthDateAge });
    expect(
      bioIssues(
        { ...complete, birth: { ...complete.birth, date: '1926-01-01' } },
        '2027-11-01',
        'biennial',
      ).birthDate,
    ).toEqual({ kind: 'invalid', message: BIO_MESSAGES.birthDateAge });
    expect(
      bioIssues(
        { ...complete, birth: { ...complete.birth, date: '2009-11-01' } },
        '2027-11-01',
        'biennial',
      ),
    ).toEqual({});
  });

  it('needs an explanation when marital status changed, and a description for Other', () => {
    const issues = bioIssues(
      {
        ...complete,
        maritalStatusChange: { changed: true },
        employment: { nature: 'other' },
      },
      '2027-11-01',
      'biennial',
    );
    expect(issues.maritalChange?.message).toBe(BIO_MESSAGES.maritalChange);
    expect(issues.natureOther?.message).toBe(BIO_MESSAGES.natureOther);
  });

  it('N11: skips the marital change on an initial declaration, which does not ask it', () => {
    // An old draft may still hold the flag; the field is hidden, so it cannot be fixed there.
    const stale = { ...complete, maritalStatusChange: { changed: true } };
    expect(bioIssues(stale, '2027-11-01', 'initial')).toEqual({});
    expect(bioIssues(stale, '2027-11-01', 'final').maritalChange?.message).toBe(
      BIO_MESSAGES.maritalChange,
    );
  });

  it('holds addresses to at least 3 characters and place of birth to 2', () => {
    const issues = bioIssues(
      {
        ...complete,
        birth: { ...complete.birth, place: 'N' },
        address: { postal: 'ab', physical: 'abc' },
      },
      '2027-11-01',
      'biennial',
    );
    expect(Object.keys(issues)).toEqual(['birthPlace', 'postal']);
  });
});
