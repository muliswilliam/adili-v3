import { createHash } from 'node:crypto';

import type {
  AssetItem,
  ChangeFlag,
  DeclarationV1,
  IncomeItem,
  LiabilityItem,
  Statement,
} from '@adili/forms';

/**
 * What an officer declares in the demo, in the registries' terms (registrations, parcel numbers,
 * companies), so the 07b registry check matches what is declared and flags what is left out.
 */
export interface Holdings {
  /** Salary over the declaration's income period, in shillings; 0 for none. */
  salaryKes: number;
  employer: string;
  vehicles: { registration: string; makeModel: string; valueKes: number }[];
  parcels: {
    parcelNumber: string;
    description: string;
    size: string;
    county: string;
    valueKes: number;
  }[];
  companies: { name: string; role: string; valueKes: number }[];
  loans: { creditor: string; description: string; outstandingKes: number }[];
  /** Spouse and children; absent for an officer who declares none. */
  household?: Household;
}

export interface Household {
  spouses: { name: PersonName; nationalId: string; kraPin: string; holdings: Holdings }[];
  children: { name: PersonName; dateOfBirth: string; nationalId: string }[];
}

type PersonName = Statement['personName'];

/** A value change the declarant must flag (review's rule: 25% or more either way). */
const MATERIAL_RATIO = 0.25;

/** A stable item id, so the same holding has the same id in every version and cycle. */
export function itemId(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The change flag of an item against the previous declaration on Adili. With none to compare
 * (an initial, or the officer's first declaration on Adili) nothing is flagged.
 */
function change(
  previous: number | undefined,
  current: number,
  compare: boolean,
  what: string,
): ChangeFlag {
  if (!compare) return { changed: false };
  if (previous === undefined) {
    return {
      changed: true,
      kind: 'acquisition',
      explanation: `${what} acquired since the last declaration.`,
    };
  }
  const ratio = previous === 0 ? 1 : Math.abs(current - previous) / previous;
  return ratio >= MATERIAL_RATIO
    ? {
        changed: true,
        kind: 'value-change',
        explanation: `${what} changed in value since the last declaration.`,
      }
    : { changed: false };
}

const cents = (shillings: number) => ({ kesCents: Math.round(shillings * 100) });

/**
 * The officer's salary, flagged against the previous declaration's when `compare`, without its
 * amount (`incomeItems` adds it).
 */
function salaryItems(
  holdings: Holdings,
  previous: Holdings | undefined,
  compare: boolean,
): Omit<IncomeItem, 'amount'>[] {
  if (holdings.salaryKes === 0) return [];
  const salaryChange = change(previous?.salaryKes, holdings.salaryKes, compare, 'Salary');
  return [
    {
      id: itemId('salary'),
      type: 'salary-emoluments',
      description: `Salary from ${holdings.employer}`,
      location: { inKenya: true, county: '047' },
      // A salary is a source the officer had before; its change is in value.
      change:
        salaryChange.kind === 'acquisition'
          ? {
              changed: true,
              kind: 'new-source',
              explanation: 'New employment since the last declaration.',
            }
          : salaryChange,
    },
  ];
}

const incomeItems = (
  holdings: Holdings,
  previous: Holdings | undefined,
  compare: boolean,
): IncomeItem[] =>
  salaryItems(holdings, previous, compare).map((item) => ({
    ...item,
    amount: cents(holdings.salaryKes),
  }));

/** The officer's loans, flagged against the previous declaration's when `compare`. */
function liabilityItems(
  holdings: Holdings,
  previous: Holdings | undefined,
  compare: boolean,
): LiabilityItem[] {
  return holdings.loans.map((loan) => ({
    id: itemId('loan', loan.creditor),
    type: 'loan',
    description: loan.description,
    creditor: loan.creditor,
    outstanding: cents(loan.outstandingKes),
    location: { inKenya: true, county: '047' },
    change: change(
      previous?.loans.find((l) => l.creditor === loan.creditor)?.outstandingKes,
      loan.outstandingKes,
      compare,
      loan.description,
    ),
  }));
}

/**
 * What a new declaration's officer statement carries over unchanged from the previous one (#682,
 * #704): its income and liabilities exactly as declared, so the comparison pairs each with itself
 * and flags only what really changed. The income goes without its amount, which is the new
 * period's for the declarant to enter; assets are left for the live filing (the registries and the
 * documents read into the form put them in).
 */
export function carriedOverStatement(previous: Holdings): {
  incomeNil: boolean;
  income: Omit<IncomeItem, 'amount'>[];
  liabilitiesNil: boolean;
  liabilities: LiabilityItem[];
} {
  const income = salaryItems(previous, previous, true);
  const liabilities = liabilityItems(previous, previous, true);
  return {
    incomeNil: income.length === 0,
    income,
    liabilitiesNil: liabilities.length === 0,
    liabilities,
  };
}

/**
 * The officer's statement section (`statement:officer`) for holdings, flagged against the
 * previous declaration's holdings when the declaration follows one.
 */
export function officerStatement(
  frame: {
    statementDate: string;
    incomePeriod: { from: string; to: string };
    personName: PersonName;
    personKey?: Statement['personKey'];
  },
  holdings: Holdings,
  previous: Holdings | undefined,
  followsEarlier: boolean,
): Statement {
  const compare = followsEarlier && previous !== undefined;
  const income = incomeItems(holdings, previous, compare);
  const assets: AssetItem[] = [
    ...holdings.vehicles.map((vehicle): AssetItem => ({
      id: itemId('vehicle', vehicle.registration),
      type: 'vehicle',
      description: vehicle.makeModel,
      details: { registration: vehicle.registration, makeModel: vehicle.makeModel },
      value: cents(vehicle.valueKes),
      location: { inKenya: true, county: '047' },
      joint: { isJoint: false },
      change: change(
        previous?.vehicles.find((v) => v.registration === vehicle.registration)?.valueKes,
        vehicle.valueKes,
        compare,
        vehicle.makeModel,
      ),
    })),
    ...holdings.parcels.map((parcel): AssetItem => ({
      id: itemId('parcel', parcel.parcelNumber),
      type: 'land',
      description: parcel.description,
      details: { parcelNumber: parcel.parcelNumber, size: parcel.size },
      value: cents(parcel.valueKes),
      location: { inKenya: true, county: parcel.county },
      joint: { isJoint: false },
      change: change(
        previous?.parcels.find((p) => p.parcelNumber === parcel.parcelNumber)?.valueKes,
        parcel.valueKes,
        compare,
        parcel.description,
      ),
    })),
    ...holdings.companies.map((company): AssetItem => ({
      id: itemId('company', company.name),
      type: 'shareholding',
      description: `Shares in ${company.name}`,
      details: { issuer: company.name },
      value: cents(company.valueKes),
      location: { inKenya: true, county: '047' },
      joint: { isJoint: false },
      change: change(
        previous?.companies.find((c) => c.name === company.name)?.valueKes,
        company.valueKes,
        compare,
        `Shares in ${company.name}`,
      ),
    })),
  ];
  const liabilities = liabilityItems(holdings, previous, compare);
  return {
    personKey: frame.personKey ?? 'officer',
    personName: frame.personName,
    statementDate: frame.statementDate,
    incomePeriod: frame.incomePeriod,
    incomeNil: income.length === 0,
    income,
    assetsNil: assets.length === 0,
    assets,
    liabilitiesNil: liabilities.length === 0,
    liabilities,
  };
}

/** The household section; the volume officers declare no spouse and no children. */
export function householdSection(
  household: Household | undefined,
  statementDate: string,
): Pick<DeclarationV1, 'spouses' | 'children'> {
  if (!household)
    return { spouses: { none: true, items: [] }, children: { none: true, items: [] } };
  return {
    spouses: {
      none: household.spouses.length === 0,
      items: household.spouses.map((spouse) => ({
        id: itemId('spouse', spouse.nationalId),
        name: spouse.name,
        nationalId: spouse.nationalId,
        kraPin: spouse.kraPin,
        occupationSector: 'private' as const,
        separated: false,
      })),
    },
    children: {
      none: household.children.length === 0,
      items: household.children.map((child) => ({
        id: itemId('child', child.nationalId),
        name: child.name,
        dateOfBirth: child.dateOfBirth,
        nationalId: child.nationalId,
        includedAtStatementDate: underEighteenOn(child.dateOfBirth, statementDate),
      })),
    },
  };
}

function underEighteenOn(dateOfBirth: string, date: string): boolean {
  const eighteenth = `${String(Number(dateOfBirth.slice(0, 4)) + 18)}${dateOfBirth.slice(4)}`;
  return eighteenth > date;
}

/** A child's statement: nothing to declare. */
export function nilStatement(
  frame: { statementDate: string; incomePeriod: { from: string; to: string } },
  personKey: Statement['personKey'],
  personName: PersonName,
): Statement {
  return {
    personKey,
    personName,
    statementDate: frame.statementDate,
    incomePeriod: frame.incomePeriod,
    incomeNil: true,
    income: [],
    assetsNil: true,
    assets: [],
    liabilitiesNil: true,
    liabilities: [],
  };
}

/** The other-information section: directorships from the holdings, nothing else to declare. */
export function otherInformation(
  holdings: Holdings,
  previous: Holdings | undefined,
  followsEarlier: boolean,
): DeclarationV1['otherInformation'] {
  return {
    materialChanges: [],
    registrableInterests: {
      directorships: holdings.companies.map((company) => ({
        company: company.name,
        role: company.role,
        remunerated: false,
        ...(followsEarlier && {
          change:
            !previous || previous.companies.some((c) => c.name === company.name)
              ? { changed: false }
              : {
                  changed: true,
                  kind: 'acquisition' as const,
                  explanation: 'Became a director since the last declaration.',
                },
        }),
      })),
      memberships: [],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  };
}
