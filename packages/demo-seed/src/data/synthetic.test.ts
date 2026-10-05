import { describe, expect, it } from 'vitest';

import { CURRENT_CYCLE, PREVIOUS_CYCLE } from './personas.js';
import { behaviourOf, holdingsOf, type SyntheticOfficer } from './synthetic.js';

const officer = (nationalId: string): SyntheticOfficer => ({
  personnelFileNumber: `NPS/2010/${nationalId}`,
  fullName: 'Kibet Peter Achieng',
  nationalId,
  designation: 'Clerical Officer',
  jobGroup: 'G',
  reportingEntity: 'National Police Service',
  employerCode: 'NPS',
  appointmentDate: '2010-01-04',
  email: 'kibet@npsc.go.ke',
  phone: '+254730000000',
  dateOfBirth: '1980-01-01',
  sex: 'M',
  placeOfBirth: 'Nairobi',
  kraPin: 'A63000000A',
  taxCompliant: true,
  annualIncomeKes: 1_000_000,
  holdings: [
    {
      kind: 'vehicle',
      reference: 'KDA 001A',
      description: 'Toyota Axio',
      registeredOn: '2015-01-01',
      valueKes: 800_000,
    },
    {
      kind: 'parcel',
      reference: 'NAKURU/DEMO 3/1',
      description: 'Plot in Nakuru',
      registeredOn: '2025-03-01',
      valueKes: 2_000_000,
    },
  ],
});

describe('synthetic officers', () => {
  it('behave the same on every run', () => {
    expect(behaviourOf(officer('63000001'))).toEqual(behaviourOf(officer('63000001')));
  });

  it('mostly file, and a minority does not', () => {
    const all = Array.from({ length: 2000 }, (_, n) =>
      behaviourOf(officer(String(63_000_000 + n))),
    );
    const share = (pick: (b: (typeof all)[number]) => boolean) =>
      all.filter(pick).length / all.length;
    expect(share((b) => b.filesPrevious)).toBeGreaterThan(0.9);
    expect(share((b) => b.filesCurrent)).toBeGreaterThan(0.8);
    expect(share((b) => b.filesCurrent)).toBeLessThan(0.95);
    expect(share((b) => b.omitsHolding)).toBeGreaterThan(0.02);
  });

  it('declare what was registered by the statement date: a later holding is a change', () => {
    expect(holdingsOf(officer('63000001'), '2024-06-30', PREVIOUS_CYCLE).parcels).toEqual([]);
    const current = holdingsOf(officer('63000003'), '2026-06-30', CURRENT_CYCLE);
    expect(current.salaryKes).toBe(2_160_000);
  });
});
