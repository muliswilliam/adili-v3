import type {
  AssetItem,
  DeclarationV1,
  IncomeItem,
  LiabilityItem,
  Spouse,
  Statement,
} from '@adili/forms';

/** Complete capture section contents for a married officer with one spouse and one child. */

export const SPOUSE_ID = '0192f1a0-5a11-7000-8000-000000000101';
export const CHILD_ID = '0192f1a0-5a11-7000-8000-000000000201';

export function bio(): DeclarationV1['officer'] {
  return {
    name: { surname: 'Otieno', firstName: 'James' },
    birth: { date: '1974-03-12', place: 'Kisumu' },
    maritalStatus: 'married',
    address: { postal: 'P.O. Box 40123-00100, Nairobi', physical: 'Lavington, Nairobi' },
    employment: {
      designation: 'Deputy Director, Procurement',
      employer: 'Ministry of Roads and Transport',
      nature: 'permanent',
      responsibleCommission: 'psc',
    },
  };
}

export function spouse(overrides: Partial<Spouse> = {}): Spouse {
  return {
    id: SPOUSE_ID,
    name: { surname: 'Otieno', firstName: 'Grace' },
    separated: false,
    ...overrides,
  };
}

export function household(): Pick<DeclarationV1, 'spouses' | 'children'> {
  return {
    spouses: { none: false, items: [spouse()] },
    children: {
      none: false,
      items: [
        {
          id: CHILD_ID,
          name: { surname: 'Otieno', firstName: 'Faith' },
          dateOfBirth: '2010-09-15',
          includedAtStatementDate: true,
        },
      ],
    },
  };
}

export function incomeItem(): IncomeItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000001001',
    type: 'salary-emoluments',
    description: 'Salary',
    amount: { kesCents: 480000000 },
    location: { inKenya: true, county: '047' },
    change: { changed: false },
  };
}

export function assetItem(): AssetItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000002001',
    type: 'vehicle',
    description: 'Toyota Prado',
    value: { kesCents: 650000000 },
    location: { inKenya: true, county: '047' },
    joint: { isJoint: false },
    change: { changed: false },
  };
}

export function liabilityItem(): LiabilityItem {
  return {
    id: '0192f1a0-5a11-7000-8000-000000003001',
    type: 'loan',
    description: 'Car loan',
    creditor: 'Equity Bank Kenya',
    outstanding: { kesCents: 120000000 },
    location: { inKenya: true, county: '047' },
    change: { changed: false },
  };
}

/** A statement with one salary, one asset and nil liabilities. */
export function statement(): Statement {
  return {
    personKey: 'officer',
    personName: { surname: 'Otieno', firstName: 'James' },
    statementDate: '2027-11-01',
    incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
    incomeNil: false,
    income: [incomeItem()],
    assetsNil: false,
    assets: [assetItem()],
    liabilitiesNil: true,
    liabilities: [],
  };
}

export function other(): DeclarationV1['otherInformation'] {
  return {
    materialChanges: [],
    registrableInterests: {
      directorships: [],
      memberships: [],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  };
}
