import { sectionIssues } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  carriedOverStatement,
  householdSection,
  itemId,
  nilStatement,
  officerStatement,
  otherInformation,
} from './declaration.js';
import { PERSONAS } from './personas.js';

const frame = {
  statementDate: '2026-06-30',
  incomePeriod: { from: '2024-06-30', to: '2026-06-30' },
  personName: { surname: 'Kamau', firstName: 'Wanjiku' },
};

describe('the declarations the seed files', () => {
  it('are valid sections for every persona, previous and current', () => {
    const child = `child:${itemId('child', '1')}` as const;
    for (const persona of PERSONAS) {
      const { previous, current } = persona.filings;
      for (const [holdings, before] of [
        [previous, undefined],
        [current ?? previous, previous],
      ] as const) {
        expect(
          sectionIssues('statement:officer', officerStatement(frame, holdings, before, true)),
        ).toEqual([]);
        expect(
          sectionIssues('household', householdSection(holdings.household, frame.statementDate)),
        ).toEqual([]);
        expect(sectionIssues('other', otherInformation(holdings, before, true))).toEqual([]);
      }
    }
    expect(
      sectionIssues(`statement:${child}`, nilStatement(frame, child, frame.personName)),
    ).toEqual([]);
  });

  it('flag what changed since the previous declaration, and nothing without one', () => {
    const before = {
      salaryKes: 1_000_000,
      employer: 'PSC',
      vehicles: [],
      parcels: [],
      companies: [],
      loans: [],
    };
    const now = {
      ...before,
      salaryKes: 1_100_000,
      vehicles: [{ registration: 'KAA 001A', makeModel: 'Toyota Axio', valueKes: 900_000 }],
    };
    const compared = officerStatement(frame, now, before, true);
    expect(compared.income[0]?.change).toEqual({ changed: false });
    expect(compared.assets[0]?.change).toMatchObject({ changed: true, kind: 'acquisition' });
    expect(officerStatement(frame, now, undefined, true).assets[0]?.change).toEqual({
      changed: false,
    });
  });

  it('carry the previous income and liabilities over as declared, so nothing reads as new or gone (#704)', () => {
    const wanjiku = PERSONAS.find((persona) => persona.demoKey === 'wanjiku');
    if (!wanjiku?.filings.startsCurrent) throw new Error('Wanjiku starts her current declaration');
    const { previous } = wanjiku.filings;
    const declared = officerStatement(frame, previous, undefined, false);
    const carried = carriedOverStatement(previous);

    // The comparison pairs items by type and description: each carried item is its declared self.
    const key = (item: { type: string; description: string }) => [item.type, item.description];
    expect(carried.income.map(key)).toEqual(declared.income.map(key));
    expect(carried.liabilities).toEqual(declared.liabilities);
    expect(carried.liabilitiesNil).toBe(false);
    expect(carried.liabilities).not.toHaveLength(0);
    // The salary for the new period is hers to enter; nothing carried is marked as changed.
    expect(carried.income.every((item) => !('amount' in item))).toBe(true);
    expect([...carried.income, ...carried.liabilities].map((item) => item.change)).toEqual(
      [...carried.income, ...carried.liabilities].map(() => ({ changed: false })),
    );
  });

  it('give a holding the same item id in every cycle', () => {
    expect(itemId('vehicle', 'KAA 001A')).toBe(itemId('vehicle', 'KAA 001A'));
    expect(itemId('vehicle', 'KAA 001A')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
