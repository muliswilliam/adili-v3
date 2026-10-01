import type { AssetItem, Child, DeclarationV1, IncomeItem, Spouse, Statement } from '@adili/forms';

import { asset, declaration, income, statement } from './declarations.js';
import { BARAKA, IMANI, PETER } from './registries.js';

/**
 * Wanjiku Kamau's household as the demo files her declaration (mocks/demo/REGISTRY_FLAGS.md),
 * with builders for the items registries are matched on.
 */

export const PETER_ID = '0192f1a0-5a11-7000-8000-00000000a001';
export const IMANI_ID = '0192f1a0-5a11-7000-8000-00000000a002';
export const BARAKA_ID = '0192f1a0-5a11-7000-8000-00000000a003';
export const SPOUSE = `spouse:${PETER_ID}`;
export const IMANI_KEY = `child:${IMANI_ID}`;
export const BARAKA_KEY = `child:${BARAKA_ID}`;

/** Two years' salary in KES cents, so the annual figure is the seed's KRA income. */
export const twoYears = (annualKes: number): IncomeItem =>
  income({ amount: { kesCents: annualKes * 2 * 100 } });

export const vehicle = (
  registration: string | undefined,
  description = 'Toyota Fielder',
): AssetItem =>
  asset({
    type: 'vehicle',
    description,
    details: registration === undefined ? {} : { registration },
    value: { kesCents: 120_000_000 },
  });

export const land = (
  parcelNumber: string | undefined,
  type: AssetItem['type'] = 'land',
): AssetItem =>
  asset({
    type,
    description: 'Plot in Ruiru',
    details: parcelNumber === undefined ? {} : { parcelNumber },
    value: { kesCents: 850_000_000 },
  });

export const shares = (issuer: string, type: AssetItem['type'] = 'shareholding'): AssetItem =>
  asset({
    type,
    description: 'Shares in a family company',
    details: { issuer, quantityOrPercent: '400 shares' },
    value: { kesCents: 40_000_000 },
  });

export interface Household {
  officer: Statement;
  spouse: Statement;
  imani: Statement;
  baraka: Statement;
  directorships: { company: string; role: string; remunerated: boolean }[];
}

/**
 * Wanjiku Kamau's demo declaration as the demo files it: the Fielder, the Kiambu parcel and her
 * Afya Bora directorship (paragraph 9); her spouse's Mazda and Afya Bora shares, as a BRS
 * pre-fill writes them (by company name); the children with nothing to declare.
 */
export function wanjikuHousehold(): Household {
  return {
    officer: statement('officer', {
      income: [twoYears(3_120_000)],
      assets: [land('KIAMBU/RUIRU EAST BLOCK 2/4417'), vehicle('KCX 214J')],
    }),
    spouse: statement(SPOUSE, {
      income: [
        income({ type: 'business', description: 'Pharmacy', amount: { kesCents: 372_000_000 } }),
      ],
      assets: [vehicle('KCB 903T', 'Mazda CX-5'), shares('Afya Bora Medical Supplies Ltd')],
    }),
    imani: statement(IMANI_KEY),
    baraka: statement(BARAKA_KEY),
    directorships: [
      {
        company: 'Afya Bora Medical Supplies Limited (PVT-9XYZ2L4Q)',
        role: 'Director',
        remunerated: false,
      },
    ],
  };
}

export function wanjikuDocument(
  household: Household,
  ids: { baraka?: string } = {},
): DeclarationV1 {
  const base = declaration([
    household.officer,
    household.spouse,
    household.imani,
    household.baraka,
  ]);
  const spouse: Spouse = {
    id: PETER_ID,
    name: { surname: 'Kamau', firstName: 'Peter', otherNames: 'Mwangi' },
    nationalId: PETER.nationalId,
    separated: false,
  };
  const child = (id: string, firstName: string, nationalId?: string): Child => ({
    id,
    name: { surname: 'Kamau', firstName },
    dateOfBirth: '2012-06-21',
    ...(nationalId ? { nationalId } : {}),
    includedAtStatementDate: true,
  });
  return {
    ...base,
    officer: {
      ...base.officer,
      name: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njoki' },
    },
    spouses: { none: false, items: [spouse] },
    children: {
      none: false,
      items: [
        child(IMANI_ID, 'Imani', IMANI.nationalId),
        child(BARAKA_ID, 'Baraka', 'baraka' in ids ? ids.baraka : BARAKA.nationalId),
      ],
    },
    otherInformation: {
      ...base.otherInformation,
      registrableInterests: {
        ...base.otherInformation.registrableInterests,
        directorships: household.directorships,
      },
    },
  };
}
