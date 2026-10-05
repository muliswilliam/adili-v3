import { describe, expect, it } from 'vitest';

import { fixtureRoster, type HeldRow, rosterDrift } from './roster.js';

/** The roster-only officer beat B onboards live (#679). */
const lydia = () => {
  const row = fixtureRoster('psc').find((r) => r.personnelFileNumber === 'PSC/2012/0311');
  if (!row) throw new Error('PSC/2012/0311 is not in the PSC fixture');
  return row;
};

const heldAs = (overrides: Partial<HeldRow> = {}): HeldRow => {
  const row = lydia();
  return {
    fullName: row.fullName,
    designation: row.designation,
    jobGroup: row.jobGroup,
    nationalId: row.nationalId,
    appointmentDate: row.appointmentDate,
    email: row.email,
    phone: row.phone,
    ...overrides,
  };
};

describe('rosterDrift', () => {
  it('names the roster-only PSC officer as IPRS does: Lydia Kwamboka Nyaboke', () => {
    expect(lydia()).toMatchObject({
      fullName: 'Lydia Kwamboka Nyaboke',
      nationalId: '28836510',
      email: 'lydia.nyaboke@publicservice.go.ke',
    });
  });

  it('finds nothing to import for a record as the fixture holds it', () => {
    expect(rosterDrift(heldAs(), lydia())).toEqual([]);
  });

  it('puts back the record a stale roster file renamed (#679)', () => {
    const held = heldAs({
      fullName: 'Achieng Atieno Njeri',
      email: 'achieng.njeri@publicservice.go.ke',
    });
    expect(rosterDrift(held, lydia())).toEqual(['fullName', 'email']);
  });

  it('puts back a contact that alone drifted', () => {
    expect(rosterDrift(heldAs({ phone: '+254700000000' }), lydia())).toEqual(['phone']);
  });

  it('compares as the import normalises: whitespace, email case, empty cells', () => {
    const row = {
      ...lydia(),
      fullName: ' Lydia  Kwamboka Nyaboke ',
      email: 'Lydia.Nyaboke@publicservice.go.ke',
      designation: '',
    };
    expect(rosterDrift(heldAs({ designation: null }), row)).toEqual([]);
  });

  it('compares only the fields read: a synthetic officer by its list fields', () => {
    const { fullName, designation, jobGroup } = heldAs();
    expect(
      rosterDrift({ fullName, designation, jobGroup }, { ...lydia(), email: 'x@y.go.ke' }),
    ).toEqual([]);
  });
});
