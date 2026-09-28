import type {
  AssetItem,
  DeclarationV1,
  IncomeItem,
  LiabilityItem,
  Location,
  Statement,
} from '@adili/forms';

/** Builders for the declaration documents the rules engine reads (declaration.v1). */

export const SPOUSE = 'spouse:0192f1a0-5a11-7000-8000-000000000101';

const KENYA: Location = { inKenya: true, county: '047' };
let sequence = 0;
const nextId = () => `0192f1a0-5a11-7000-8000-${String((sequence += 1)).padStart(12, '0')}`;

export function income(overrides: Partial<IncomeItem> = {}): IncomeItem {
  return {
    id: nextId(),
    type: 'salary-emoluments',
    description: 'Salary',
    amount: { kesCents: 480_000_000 },
    location: KENYA,
    change: { changed: false },
    ...overrides,
  };
}

export function asset(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: nextId(),
    type: 'land',
    description: 'Plot in Kisumu',
    value: { kesCents: 1_000_000_000 },
    location: KENYA,
    joint: { isJoint: false },
    change: { changed: false },
    ...overrides,
  };
}

export function liability(overrides: Partial<LiabilityItem> = {}): LiabilityItem {
  return {
    id: nextId(),
    type: 'loan',
    description: 'Car loan',
    creditor: 'Equity Bank Kenya',
    outstanding: { kesCents: 120_000_000 },
    location: KENYA,
    change: { changed: false },
    ...overrides,
  };
}

/** A statement; a category left empty is declared nil. */
export function statement(
  personKey: string,
  items: { income?: IncomeItem[]; assets?: AssetItem[]; liabilities?: LiabilityItem[] } = {},
): Statement {
  const { income: inc = [], assets = [], liabilities = [] } = items;
  return {
    personKey,
    personName: { surname: 'Otieno', firstName: personKey === 'officer' ? 'James' : 'Grace' },
    statementDate: '2027-11-01',
    incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
    incomeNil: inc.length === 0,
    income: inc,
    assetsNil: assets.length === 0,
    assets,
    liabilitiesNil: liabilities.length === 0,
    liabilities,
  };
}

/** A declaration with the given statements; household and bio are fixed, as the rules ignore them. */
export function declaration(
  statements: Statement[],
  materialChanges: DeclarationV1['otherInformation']['materialChanges'] = [],
): DeclarationV1 {
  return {
    schemaVersion: 'declaration.v1',
    type: 'biennial',
    statementDate: '2027-11-01',
    incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'declared' },
    officer: {
      name: { surname: 'Otieno', firstName: 'James' },
      birth: { date: '1974-03-12', place: 'Kisumu' },
      maritalStatus: 'married',
      address: { postal: 'P.O. Box 40123-00100, Nairobi', physical: 'Lavington, Nairobi' },
      employment: {
        designation: 'Deputy Director',
        employer: 'Ministry of Roads and Transport',
        nature: 'permanent',
        responsibleCommission: 'psc',
      },
    },
    spouses: { none: true, items: [] },
    children: { none: true, items: [] },
    statements,
    otherInformation: {
      materialChanges,
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: '',
    },
    attestation: {
      text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
    },
  };
}

/** The same item in a later version: same content, new id, new value. */
export function revalued<T extends AssetItem | IncomeItem | LiabilityItem>(
  item: T,
  kesCents: number,
): T {
  if ('value' in item) return { ...item, id: nextId(), value: { kesCents } };
  if ('amount' in item) return { ...item, id: nextId(), amount: { kesCents } };
  return { ...item, id: nextId(), outstanding: { kesCents } };
}
