import { describe, expect, it } from 'vitest';

import { applyLockedFields, shapeErrors, splitFullName } from '../../src/drafts/sections.js';
import { bio, statement } from '../fixtures/sections.js';

describe('splitFullName', () => {
  it.each([
    ['Achieng Otieno', { firstName: 'Achieng', surname: 'Otieno' }],
    [
      '  Achieng  Wambui Awino Otieno ',
      { firstName: 'Achieng', otherNames: 'Wambui Awino', surname: 'Otieno' },
    ],
    ['Otieno', { surname: 'Otieno' }],
    ['', {}],
  ])('splits %j', (fullName, expected) => {
    expect(splitFullName(fullName)).toEqual(expected);
  });
});

describe('shapeErrors', () => {
  it('accepts a complete section', () => {
    expect(shapeErrors('bio', bio())).toEqual([]);
    expect(shapeErrors('statement:officer', statement())).toEqual([]);
  });

  it('accepts what is only missing or not yet long enough: that is completeness', () => {
    const partial: Partial<ReturnType<typeof bio>> = bio();
    delete partial.address;
    expect(shapeErrors('bio', { ...partial, birth: { place: 'K' } })).toEqual([]);
    expect(shapeErrors('household', {})).toEqual([]);
    expect(
      shapeErrors('statement:officer', {
        ...statement(),
        income: [{ id: '0192f1a0-5a11-7000-8000-000000001001', change: { changed: true } }],
      }),
    ).toEqual([]);
  });

  it('refuses wrong types, formats, enums, unknown fields and values out of range', () => {
    const paths = (body: unknown) => shapeErrors('bio', body).map((error) => error.path);

    expect(paths({ ...bio(), maritalStatus: 'complicated' })).toEqual(['maritalStatus']);
    expect(paths({ ...bio(), birth: { date: '12/03/1974', place: 'Kisumu' } })).toEqual([
      'birth.date',
    ]);
    expect(paths({ ...bio(), nickname: 'Jim' })).toEqual(['']);
    expect(paths({ ...bio(), address: null })).toEqual(['address']);
    expect(paths('bio')).toEqual(['']);
    expect(
      shapeErrors('statement:officer', {
        ...statement(),
        income: [{ amount: { kesCents: -1 } }],
      }).map((error) => error.path),
    ).toEqual(['income.0.amount.kesCents']);
  });
});

describe('applyLockedFields', () => {
  const stored = { name: { surname: 'Otieno', firstName: 'James' }, employment: { employer: 'X' } };
  const locked = ['/name/surname', '/name/firstName', '/employment/employer'];

  it('fills in locked fields the body leaves out', () => {
    expect(applyLockedFields({ employment: { nature: 'permanent' } }, stored, locked)).toEqual({
      contents: {
        name: { surname: 'Otieno', firstName: 'James' },
        employment: { nature: 'permanent', employer: 'X' },
      },
      changed: [],
    });
  });

  it('names the locked fields the body changes', () => {
    expect(
      applyLockedFields(
        { ...stored, name: { surname: 'Odhiambo', firstName: 'James' } },
        stored,
        locked,
      ).changed,
    ).toEqual(['/name/surname']);
  });
});
