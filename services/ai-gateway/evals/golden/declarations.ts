import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Synthetic declaration.v1 documents for the golden sets, built from the committed form fixtures
 * (packages/schemas/forms/fixtures/declaration.v1). No real person appears in them. The previous
 * versions are derived here: the fixtures have no version pairs.
 */

type Json = Record<string, unknown>;

const require = createRequire(import.meta.url);

function fixture(name: string): Json {
  const path = require.resolve(`@adili/schemas/forms/fixtures/declaration.v1/valid/${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

const HOUSEHOLD = fixture('biennial-household');
const INITIAL_NIL = fixture('initial-nil');

/** Ids of the household fixture, by what they are. */
export const IDS = {
  graceSpouse: '0192f1a0-5a11-7000-8000-000000000101',
  marySpouse: '0192f1a0-5a11-7000-8000-000000000102',
  faithChild: '0192f1a0-5a11-7000-8000-000000000202',
  salary: '0192f1a0-5a11-7000-8000-000000001001',
  rent: '0192f1a0-5a11-7000-8000-000000001002',
  plot: '0192f1a0-5a11-7000-8000-000000002001',
  savings: '0192f1a0-5a11-7000-8000-000000002002',
  prado: '0192f1a0-5a11-7000-8000-000000002003',
  pharmacyProfit: '0192f1a0-5a11-7000-8000-000000001101',
  plotShare: '0192f1a0-5a11-7000-8000-000000002101',
  pharmacyLoan: '0192f1a0-5a11-7000-8000-000000003101',
  marySalary: '0192f1a0-5a11-7000-8000-000000001201',
  faithFund: '0192f1a0-5a11-7000-8000-000000002401',
  /** Not in the fixture: a vehicle the previous version declared and the current one does not. */
  axio: '0199e0a0-e7a1-7000-8000-000000002004',
} as const;

export const PEOPLE = {
  officer: 'officer',
  grace: `spouse:${IDS.graceSpouse}`,
  mary: `spouse:${IDS.marySpouse}`,
  faith: `child:${IDS.faithChild}`,
} as const;

interface Item extends Json {
  id: string;
}

interface Statement extends Json {
  personKey: string;
  income: Item[];
  assets: Item[];
  liabilities: Item[];
}

/** A declaration document with typed access to what the builders change. */
export interface Declaration extends Json {
  statements: Statement[];
  spouses: { none: boolean; items: Json[] };
  otherInformation: { materialChanges: Json[] } & Json;
}

/** The current version: the household fixture, a biennial declaration for 2024-2025. */
export function household(): Declaration {
  return structuredClone(HOUSEHOLD) as Declaration;
}

/** An initial declaration declaring nil throughout. */
export function initialNil(): Declaration {
  return structuredClone(INITIAL_NIL) as Declaration;
}

export function statementOf(document: Declaration, personKey: string): Statement {
  const statement = document.statements.find((each) => each.personKey === personKey);
  if (!statement) throw new Error(`No statement for ${personKey}`);
  return statement;
}

export function itemOf(document: Declaration, itemId: string): Item {
  for (const statement of document.statements) {
    for (const item of [...statement.income, ...statement.assets, ...statement.liabilities]) {
      if (item.id === itemId) return item;
    }
  }
  throw new Error(`No item ${itemId}`);
}

/** Sets the amount of an item in KES cents, whichever field its category uses. */
export function setValue(document: Declaration, itemId: string, kesCents: number): void {
  const item = itemOf(document, itemId);
  const field = 'amount' in item ? 'amount' : 'value' in item ? 'value' : 'outstanding';
  item[field] = { ...(item[field] as Json), kesCents };
}

function remove(document: Declaration, itemId: string): void {
  for (const statement of document.statements) {
    statement.income = statement.income.filter((item) => item.id !== itemId);
    statement.assets = statement.assets.filter((item) => item.id !== itemId);
    statement.liabilities = statement.liabilities.filter((item) => item.id !== itemId);
  }
}

const unchanged = { changed: false };

/**
 * The previous biennial version (2022-2023) of the household declaration: one spouse, no rent,
 * no Prado, less in the US savings account and more owed on the pharmacy loan. Every item is
 * marked unchanged, as a declaration with no earlier one to compare would be.
 */
export function previousHousehold(): Declaration {
  const previous = household();
  previous.statementDate = '2023-12-31';
  previous.incomePeriod = { from: '2022-01-01', to: '2023-12-31', fromSource: 'declared' };
  previous.officer = {
    ...(previous.officer as Json),
    maritalStatus: 'married',
    maritalStatusChange: unchanged,
  };
  previous.spouses = { none: false, items: previous.spouses.items.slice(0, 1) };
  previous.statements = previous.statements.filter((each) => each.personKey !== PEOPLE.mary);
  for (const statement of previous.statements) {
    statement.statementDate = '2023-12-31';
    statement.incomePeriod = { from: '2022-01-01', to: '2023-12-31' };
    for (const item of [...statement.income, ...statement.assets, ...statement.liabilities]) {
      item.change = unchanged;
      delete item.attachments;
    }
  }
  remove(previous, IDS.rent);
  remove(previous, IDS.prado);
  setValue(previous, IDS.savings, 90_000_000);
  setValue(previous, IDS.pharmacyLoan, 125_000_000);
  previous.otherInformation = { ...previous.otherInformation, materialChanges: [] };
  return previous;
}

/** Adds the Toyota Axio the officer declared before and sold to buy the Prado. */
export function withAxio(document: Declaration): Declaration {
  statementOf(document, PEOPLE.officer).assets.push({
    id: IDS.axio,
    type: 'vehicle',
    description: 'Toyota Axio',
    details: { registration: 'KCT 219Q', makeModel: 'Toyota Axio' },
    value: { kesCents: 120_000_000 },
    location: { inKenya: true, county: '047' },
    joint: { isJoint: false },
    change: unchanged,
  });
  return document;
}
