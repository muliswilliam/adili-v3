import type { DeclarationV1 } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { disclose, type DisclosureScope, includesPerson } from '../../src/disclosure/scope.js';

/** The cut of a `declaration.v1` document to an access scope (spec 10 S9), apart from the read. */

const SPOUSE = 'spouse:s1';
const CHILD = 'child:c1';

function statement(personKey: string) {
  return {
    personKey,
    personName: { firstName: personKey, surname: 'Kamau' },
    statementDate: '2027-11-01',
    incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
    incomeNil: true,
    income: [],
    assetsNil: true,
    assets: [],
    liabilitiesNil: true,
    liabilities: [],
  };
}

const DOCUMENT = {
  schemaVersion: 'declaration.v1',
  type: 'biennial',
  statementDate: '2027-11-01',
  incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'declared' },
  officer: { name: { firstName: 'Wanjiku', surname: 'Kamau' } },
  spouses: {
    none: false,
    items: [
      {
        id: 's1',
        name: { firstName: 'Otieno', surname: 'Kamau' },
        nationalId: '12345678',
        kraPin: 'A012345678Z',
        occupationSector: 'private',
        separated: false,
      },
    ],
  },
  children: {
    none: false,
    items: [
      {
        id: 'c1',
        name: { firstName: 'Amani', surname: 'Kamau' },
        dateOfBirth: '2015-03-14',
        nationalId: '87654321',
        includedAtStatementDate: true,
      },
    ],
  },
  statements: [statement('officer'), statement(SPOUSE), statement(CHILD)],
  otherInformation: {
    materialChanges: [
      { kind: 'directorship', explanation: 'officer' },
      { personKey: SPOUSE, kind: 'acquisition', explanation: 'spouse' },
      { personKey: CHILD, kind: 'acquisition', explanation: 'child' },
    ],
    registrableInterests: {},
    freeText: 'free',
  },
  attestation: { text: 'I solemnly declare', reference: 'DCB-PSC-2027-0000001-K' },
} as unknown as DeclarationV1;

const scope = (overrides: Partial<DisclosureScope> = {}): DisclosureScope => ({
  includeSpouses: false,
  includeChildren: false,
  sections: [],
  ...overrides,
});

describe('disclose', () => {
  it('always keeps what was declared and when, and nothing else without sections', () => {
    expect(disclose(DOCUMENT, scope())).toEqual({
      schemaVersion: 'declaration.v1',
      type: 'biennial',
      statementDate: '2027-11-01',
      attestation: DOCUMENT.attestation,
    });
  });

  it('S9: assets and liabilities of the officer alone', () => {
    const content = disclose(DOCUMENT, scope({ sections: ['assets', 'liabilities'] }));

    expect(content.statements).toEqual([
      {
        personKey: 'officer',
        personName: { firstName: 'officer', surname: 'Kamau' },
        statementDate: '2027-11-01',
        incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
        assetsNil: true,
        assets: [],
        liabilitiesNil: true,
        liabilities: [],
      },
    ]);
    expect(content).not.toHaveProperty('officer');
    expect(content).not.toHaveProperty('incomePeriod');
    expect(content).not.toHaveProperty('otherInformation');
  });

  it('bio gives the particulars of the included household members only', () => {
    expect(disclose(DOCUMENT, scope({ sections: ['bio'] }))).toMatchObject({
      officer: DOCUMENT.officer,
    });
    expect(disclose(DOCUMENT, scope({ sections: ['bio'] }))).not.toHaveProperty('spouses');
    const children = disclose(DOCUMENT, scope({ sections: ['bio'], includeChildren: true }));
    expect(children.children).toEqual({
      none: false,
      items: [
        { id: 'c1', name: { firstName: 'Amani', surname: 'Kamau' }, includedAtStatementDate: true },
      ],
    });
    expect(children).not.toHaveProperty('spouses');
    expect(children).not.toHaveProperty('statements');
  });

  it("never discloses household members' national IDs, KRA PINs or dates of birth", () => {
    const content = disclose(
      DOCUMENT,
      scope({ sections: ['bio'], includeSpouses: true, includeChildren: true }),
    );

    expect(content.spouses).toEqual({
      none: false,
      items: [
        {
          id: 's1',
          name: { firstName: 'Otieno', surname: 'Kamau' },
          occupationSector: 'private',
          separated: false,
        },
      ],
    });
    const serialised = JSON.stringify(content);
    for (const identifier of ['12345678', 'A012345678Z', '2015-03-14', '87654321']) {
      expect(serialised).not.toContain(identifier);
    }
  });

  it('income brings the income period, and statements of the included persons', () => {
    const content = disclose(DOCUMENT, scope({ sections: ['income'], includeChildren: true }));

    expect(content.incomePeriod).toEqual(DOCUMENT.incomePeriod);
    expect(content.statements?.map((s) => s.personKey)).toEqual(['officer', CHILD]);
    expect(Object.keys(content.statements?.[0] ?? {})).not.toContain('assets');
  });

  it('other information keeps the material changes of the included persons only', () => {
    const content = disclose(DOCUMENT, scope({ sections: ['other'], includeSpouses: true }));

    expect(content.otherInformation?.materialChanges.map((c) => c.explanation)).toEqual([
      'officer',
      'spouse',
    ]);
    expect(content.otherInformation?.freeText).toBe('free');
  });
});

describe('includesPerson', () => {
  it('includes the officer always, household members as the scope says, nobody else', () => {
    expect(includesPerson(scope(), 'officer')).toBe(true);
    expect(includesPerson(scope(), SPOUSE)).toBe(false);
    expect(includesPerson(scope({ includeSpouses: true }), SPOUSE)).toBe(true);
    expect(includesPerson(scope({ includeSpouses: true }), CHILD)).toBe(false);
    expect(includesPerson(scope({ includeChildren: true }), CHILD)).toBe(true);
    expect(includesPerson(scope({ includeSpouses: true, includeChildren: true }), 'x')).toBe(false);
  });
});
