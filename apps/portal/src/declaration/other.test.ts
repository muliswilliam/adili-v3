import { describe, expect, it } from 'vitest';

import {
  directorshipLine,
  dualCitizenshipLine,
  freeTextCounter,
  materialChangeLine,
  materialChangeStep,
  membershipLine,
  pendingCaseLine,
} from './other';

const SPOUSE = 'spouse:5f0c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
const names = (key: string) => (key === 'officer' ? 'You' : 'Mary Wanjiru Kennedy');

describe('material changes', () => {
  it('composes "{Person} · {item description}: {kind} · {explanation}"', () => {
    expect(
      materialChangeLine(
        {
          personKey: SPOUSE,
          itemDescription: 'Plot in Kapsoya',
          kind: 'acquisition',
          explanation: 'Bought in March 2026.',
        },
        names,
      ),
    ).toBe('Mary Wanjiru Kennedy · Plot in Kapsoya: acquired · Bought in March 2026.');
  });

  it('words the marital status change as the officer', () => {
    expect(
      materialChangeLine({ kind: 'marital-status', explanation: 'Married in April 2025.' }, names),
    ).toBe('You · Marital status: marital status changed · Married in April 2025.');
  });

  it('leaves out a missing explanation and names an undescribed item', () => {
    expect(materialChangeLine({ personKey: 'officer', kind: 'value-change' }, names)).toBe(
      'You · An item: value changed',
    );
  });

  it('edits an item change on the statement, the marital change on the bio and an interest here', () => {
    expect(materialChangeStep({ personKey: SPOUSE, kind: 'disposal' })).toBe(`statement:${SPOUSE}`);
    expect(materialChangeStep({ kind: 'marital-status' })).toBe('bio');
    expect(materialChangeStep({ personKey: 'officer', kind: 'directorship' })).toBe('other');
    expect(materialChangeStep({ personKey: 'officer', kind: 'membership' })).toBe('other');
  });
});

describe('registrable interests', () => {
  it('words each interest for the summary', () => {
    expect(
      directorshipLine({ company: 'Kapsoya Water Ltd', role: 'Director', remunerated: false }),
    ).toBe('Kapsoya Water Ltd, Director (unpaid)');
    expect(directorshipLine({ company: 'Kapsoya Water Ltd' })).toBe(
      'Kapsoya Water Ltd, role not answered (pay not answered)',
    );
    expect(membershipLine({ entity: 'Kapsoya Parents Welfare Group' })).toBe(
      'Kapsoya Parents Welfare Group (kind not answered)',
    );
    expect(pendingCaseLine({ forum: 'Eldoret CMC' })).toBe(
      'Eldoret CMC, reference not answered: nature not answered',
    );
    expect(membershipLine({ entity: 'Kapsoya Parents Welfare Group', kind: 'society' })).toBe(
      'Kapsoya Parents Welfare Group (Society)',
    );
    expect(
      pendingCaseLine({ forum: 'Eldoret CMC', reference: 'ELC 45 of 2025', nature: 'Boundary' }),
    ).toBe('Eldoret CMC, ELC 45 of 2025: Boundary');
  });

  it('words dual citizenship with the pending application', () => {
    expect(dualCitizenshipLine({ holds: true, country: 'UG', pendingApplication: false })).toBe(
      'Yes, Uganda · pending application: no',
    );
    expect(dualCitizenshipLine({ holds: false, pendingApplication: true })).toBe(
      'No · pending application: yes',
    );
    expect(dualCitizenshipLine(undefined)).toBe('Not answered');
    expect(dualCitizenshipLine({ holds: true })).toBe(
      'Yes, country not answered · pending application: not answered',
    );
    expect(dualCitizenshipLine({ pendingApplication: false })).toBe(
      'Not answered · pending application: no',
    );
  });

  it('counts free text against 4,000 characters', () => {
    expect(freeTextCounter(1234)).toBe('1,234 / 4,000 characters');
  });
});
