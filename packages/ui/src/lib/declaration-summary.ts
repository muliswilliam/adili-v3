import type {
  AssetItem,
  Attachment,
  ChangeFlag,
  Child,
  DeclarationV1,
  IncomeItem,
  LiabilityItem,
  Location,
  MaterialChangeEntry,
  Money,
  PersonName,
  Spouse,
  Statement,
} from '@adili/forms';

import { formatDate } from './format-date';
import { formatMoney } from './money';
import { COUNTIES, COUNTRIES } from './places';

/**
 * The words and the arithmetic of a declaration as filed (declaration.v1), for the read-only
 * First Schedule rendering (`DeclarationSummary`): labels for the schema's enumerations, totals
 * per person, an item's description line, and the anchors a reviewer jumps to.
 */

export type StatementCategory = 'income' | 'assets' | 'liabilities';

export const STATEMENT_CATEGORIES: readonly StatementCategory[] = [
  'income',
  'assets',
  'liabilities',
];

export type StatementItem = IncomeItem | AssetItem | LiabilityItem;

/** The household member a statement is for, from its person key. */
export type PersonKind = 'officer' | 'spouse' | 'child';

export interface DeclarationLabels {
  type: Record<DeclarationV1['type'], string>;
  maritalStatus: Record<DeclarationV1['officer']['maritalStatus'], string>;
  employmentNature: Record<DeclarationV1['officer']['employment']['nature'], string>;
  occupationSector: Record<NonNullable<Spouse['occupationSector']>, string>;
  incomeType: Record<IncomeItem['type'], string>;
  assetType: Record<AssetItem['type'], string>;
  liabilityType: Record<LiabilityItem['type'], string>;
  /** An item's change flag as a tag, e.g. "Marked as acquired". */
  changeTag: Record<NonNullable<ChangeFlag['kind']>, string>;
  /** A material change in paragraph 9, e.g. "value changed". */
  materialChange: Record<MaterialChangeEntry['kind'], string>;
  membershipKind: Record<
    DeclarationV1['otherInformation']['registrableInterests']['memberships'][number]['kind'],
    string
  >;
}

export const DECLARATION_LABELS: DeclarationLabels = {
  type: { initial: 'Initial', biennial: 'Biennial', final: 'Final' },
  maritalStatus: {
    single: 'Single',
    married: 'Married',
    separated: 'Separated',
    divorced: 'Divorced',
    widowed: 'Widowed',
  },
  employmentNature: {
    permanent: 'Permanent',
    temporary: 'Temporary',
    contract: 'Contract',
    other: 'Other',
  },
  occupationSector: {
    public: 'Public sector',
    private: 'Private sector',
    'not-employed': 'Not employed',
    unknown: 'Sector unknown',
  },
  incomeType: {
    'salary-emoluments': 'Salary and emoluments',
    allowances: 'Allowances',
    business: 'Business',
    rent: 'Rent',
    'dividends-interest': 'Dividends and interest',
    pension: 'Pension',
    farming: 'Farming',
    consultancy: 'Consultancy',
    other: 'Other income',
  },
  assetType: {
    land: 'Land',
    building: 'Building',
    vehicle: 'Vehicle',
    securities: 'Securities',
    shareholding: 'Shareholding',
    'bank-account': 'Bank account',
    cash: 'Cash',
    receivable: 'Money owed',
    other: 'Other asset',
  },
  liabilityType: {
    mortgage: 'Mortgage',
    loan: 'Loan',
    guarantee: 'Guarantee',
    other: 'Other liability',
  },
  changeTag: {
    'value-change': 'Marked as changed',
    acquisition: 'Marked as acquired',
    disposal: 'Marked as disposed',
    'new-source': 'Marked as a new source',
    'source-ended': 'Marked as ended',
    settled: 'Marked as settled',
  },
  materialChange: {
    'value-change': 'value changed',
    acquisition: 'acquired',
    disposal: 'disposed',
    'new-source': 'new source',
    'source-ended': 'source ended',
    settled: 'settled',
    'marital-status': 'marital status changed',
    directorship: 'directorship changed',
    membership: 'membership changed',
  },
  membershipKind: {
    company: 'Company',
    partnership: 'Partnership',
    society: 'Society',
    club: 'Club',
    foundation: 'Foundation',
    trust: 'Trust',
    other: 'Other',
  },
};

/** "Wanjiku Njeri Kamau": first name, other names, surname. */
export function personFullName(name: PersonName | undefined): string {
  if (!name) return '';
  return [name.firstName, name.otherNames, name.surname]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

/** `officer`, `spouse:<id>` or `child:<id>`. */
export function personKind(personKey: string): PersonKind {
  if (personKey.startsWith('spouse:')) return 'spouse';
  if (personKey.startsWith('child:')) return 'child';
  return 'officer';
}

/** An item's amount: the income amount, the asset value or the liability outstanding. */
export function itemMoney(category: StatementCategory, item: StatementItem): Money {
  if (category === 'income') return (item as IncomeItem).amount;
  if (category === 'assets') return (item as AssetItem).value;
  return (item as LiabilityItem).outstanding;
}

export function itemsOf(statement: Statement, category: StatementCategory): StatementItem[] {
  return statement[category];
}

export interface StatementTotals {
  income: number;
  assets: number;
  liabilities: number;
}

/** A statement's totals in cents: joint assets at their whole value, as declared. */
export function statementTotals(statement: Statement): StatementTotals {
  const sum = (category: StatementCategory) =>
    itemsOf(statement, category).reduce(
      (total, item) => total + itemMoney(category, item).kesCents,
      0,
    );
  return { income: sum('income'), assets: sum('assets'), liabilities: sum('liabilities') };
}

/** The household's totals: every statement's added up. */
export function householdTotals(statements: readonly Statement[]): StatementTotals {
  return statements.reduce<StatementTotals>(
    (total, statement) => {
      const each = statementTotals(statement);
      return {
        income: total.income + each.income,
        assets: total.assets + each.assets,
        liabilities: total.liabilities + each.liabilities,
      };
    },
    { income: 0, assets: 0, liabilities: 0 },
  );
}

export function countyName(code: string | undefined): string | undefined {
  return COUNTIES.find((county) => county.code === code)?.name;
}

export function countryName(code: string | undefined): string | undefined {
  return COUNTRIES.find((country) => country.code === code)?.name;
}

/** "Syokimau, Machakos" in Kenya, "Kampala, Uganda" outside it; empty when nothing is given. */
export function locationText(location: Location | undefined): string {
  if (!location) return '';
  const place = location.inKenya ? countyName(location.county) : countryName(location.country);
  return [location.detail?.trim(), place].filter(Boolean).join(', ');
}

/** "Sole", or "Joint, 50% share with Jane Doe". */
export function ownershipText(joint: AssetItem['joint']): string {
  if (!joint.isJoint) return 'Sole';
  const share =
    joint.sharePercent === undefined ? 'Joint' : `Joint, ${String(joint.sharePercent)}% share`;
  return joint.coOwner?.trim() ? `${share} with ${joint.coOwner.trim()}` : share;
}

/** The line under an item's type: description, creditor, place, ownership, original currency. */
export function itemDescriptionLine(category: StatementCategory, item: StatementItem): string {
  const parts = [item.description.trim()];
  if (category === 'liabilities') parts.push((item as LiabilityItem).creditor.trim());
  parts.push(locationText(item.location));
  if (category === 'assets') parts.push(ownershipText((item as AssetItem).joint));
  const original = itemMoney(category, item).original;
  if (original) {
    parts.push(`Originally ${original.currency} ${formatMoney(original.minorUnits)}`);
  }
  return parts.filter(Boolean).join(' · ');
}

const DETAIL_LABELS: [keyof NonNullable<AssetItem['details']>, string][] = [
  ['parcelNumber', 'Parcel'],
  ['size', 'Size'],
  ['registration', 'Registration'],
  ['makeModel', 'Make and model'],
  ['issuer', 'Issuer'],
  ['quantityOrPercent', 'Holding'],
  ['institution', 'Institution'],
  ['accountType', 'Account'],
  ['debtor', 'Owed by'],
];

/**
 * An asset's identifiers, e.g. "Parcel NYERI/MUKURWE-INI/1187 · Size 0.5 acre", leaving out any
 * the description already gives.
 */
export function assetDetailsLine(item: AssetItem): string {
  const details = item.details ?? {};
  const description = item.description.toLowerCase();
  return DETAIL_LABELS.flatMap(([key, label]) => {
    const value = details[key]?.trim();
    if (!value || description.includes(value.toLowerCase())) return [];
    if (key === 'accountType') {
      return [/account$/i.test(value) ? value : `${value} account`];
    }
    return [`${label} ${value}`];
  }).join(' · ');
}

export function typeLabel(
  category: StatementCategory,
  item: StatementItem,
  labels: DeclarationLabels = DECLARATION_LABELS,
): string {
  if (category === 'income') return labels.incomeType[(item as IncomeItem).type];
  if (category === 'assets') return labels.assetType[(item as AssetItem).type];
  return labels.liabilityType[(item as LiabilityItem).type];
}

/** "Born 3 Mar 2015 · Not included: 18 on the statement date" and the like. */
export function childLine(child: Child): string[] {
  const parts = [`Born ${formatDate(child.dateOfBirth)}`];
  parts.push(child.nationalId?.trim() ? 'National ID declared' : 'No national ID');
  if (!child.includedAtStatementDate) parts.push('18 or over on the statement date');
  return parts;
}

export function spouseLine(
  spouse: Spouse,
  labels: DeclarationLabels = DECLARATION_LABELS,
): string[] {
  const parts = [spouse.nationalId?.trim() ? 'National ID declared' : 'National ID not declared'];
  if (spouse.kraPin?.trim()) parts.push('KRA PIN declared');
  if (spouse.occupationSector) parts.push(labels.occupationSector[spouse.occupationSector]);
  if (spouse.separated) {
    parts.push(
      spouse.separationDate ? `Separated since ${formatDate(spouse.separationDate)}` : 'Separated',
    );
  }
  return parts;
}

/** Where a reviewer is sent: an item, or a person's statement or a section without one. */
export interface DeclarationTarget {
  itemId?: string | null;
  personKey?: string | null;
  /** `bio`, `household`, `other` or `statement:<personKey>`. */
  sectionKey?: string | null;
}

/** The DOM id of an item's row. */
export function itemAnchorId(itemId: string, prefix = 'declaration'): string {
  return `${prefix}-item-${itemId}`;
}

/** The DOM id of a section: `bio`, `household`, `other` or `statement:<personKey>`. */
export function sectionAnchorId(sectionKey: string, prefix = 'declaration'): string {
  return `${prefix}-section-${sectionKey.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

/**
 * The DOM id to scroll to for a target: the item when there is one, else the section, else the
 * person's statement; null when the target names nothing on the page.
 */
export function anchorIdFor(target: DeclarationTarget, prefix = 'declaration'): string | null {
  if (target.itemId) return itemAnchorId(target.itemId, prefix);
  if (target.sectionKey) return sectionAnchorId(target.sectionKey, prefix);
  if (target.personKey) return sectionAnchorId(`statement:${target.personKey}`, prefix);
  return null;
}

/** Every attachment of the declaration, with the item it supports. */
export interface DeclaredAttachment {
  attachment: Attachment;
  personKey: string;
  category: StatementCategory;
  item: StatementItem;
}

export function declarationAttachments(document: DeclarationV1): DeclaredAttachment[] {
  return document.statements.flatMap((statement) =>
    STATEMENT_CATEGORIES.flatMap((category) =>
      itemsOf(statement, category).flatMap((item) =>
        (item.attachments ?? []).map((attachment) => ({
          attachment,
          personKey: statement.personKey,
          category,
          item,
        })),
      ),
    ),
  );
}

/** A statement item and where it sits, e.g. for a flag's "Assets · Building · Wanjiku Kamau". */
export interface LocatedItem {
  statement: Statement;
  category: StatementCategory;
  item: StatementItem;
}

export function findItem(document: DeclarationV1, itemId: string): LocatedItem | null {
  for (const statement of document.statements) {
    for (const category of STATEMENT_CATEGORIES) {
      const item = itemsOf(statement, category).find((each) => each.id === itemId);
      if (item) return { statement, category, item };
    }
  }
  return null;
}
