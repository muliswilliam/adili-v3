import type {
  AssetType,
  ChangeKind,
  EmploymentNature,
  IncomeType,
  LiabilityType,
  MaritalStatus,
  MembershipKind,
  ObligationType,
  OccupationSector,
} from './contents';
import type { Category } from './statement';

/**
 * The one table of English labels for declaration capture: the declaration.v1 enumerations in
 * schema order, the statement categories, and the change kinds each category offers (the spec's
 * i18n table; Swahili is out of scope for spec 05). `labels.test.ts` checks every enum value has
 * one. Completeness messages are the service's, so they are not here.
 */

export const OBLIGATION_TYPE_LABELS: Record<ObligationType, string> = {
  initial: 'Initial',
  biennial: 'Biennial',
  final: 'Final',
};

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  single: 'Single',
  married: 'Married',
  separated: 'Separated',
  divorced: 'Divorced',
  widowed: 'Widowed',
};

export const EMPLOYMENT_NATURE_LABELS: Record<EmploymentNature, string> = {
  permanent: 'Permanent',
  temporary: 'Temporary',
  contract: 'Contract',
  other: 'Other',
};

export const OCCUPATION_SECTOR_LABELS: Record<OccupationSector, string> = {
  public: 'Public',
  private: 'Private',
  'not-employed': 'Not employed',
  unknown: 'Unknown',
};

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  'salary-emoluments': 'Salary and emoluments',
  allowances: 'Allowances',
  business: 'Business',
  rent: 'Rent',
  'dividends-interest': 'Dividends and interest',
  pension: 'Pension',
  farming: 'Farming',
  consultancy: 'Consultancy',
  other: 'Other',
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  land: 'Land',
  building: 'Building',
  vehicle: 'Vehicle',
  securities: 'Securities',
  shareholding: 'Shareholding',
  'bank-account': 'Bank account',
  cash: 'Cash',
  receivable: 'Money owed to me',
  other: 'Other',
};

export const LIABILITY_TYPE_LABELS: Record<LiabilityType, string> = {
  mortgage: 'Mortgage',
  loan: 'Loan',
  guarantee: 'Guarantee',
  other: 'Other',
};

/**
 * Change kinds in a sentence where the category is not known, e.g. a material change in
 * paragraph 9: "value changed".
 */
export const CHANGE_KIND_WORDS: Record<ChangeKind, string> = {
  'value-change': 'value changed',
  acquisition: 'acquired',
  disposal: 'disposed',
  'new-source': 'new source',
  'source-ended': 'source ended',
  settled: 'settled',
};

export const MEMBERSHIP_KIND_LABELS: Record<MembershipKind, string> = {
  company: 'Company',
  partnership: 'Partnership',
  society: 'Society',
  club: 'Club',
  foundation: 'Foundation',
  trust: 'Trust',
  other: 'Other',
};

/** Completeness in words, as the section list and navigation show it. */
export const COMPLETENESS_LABELS = {
  'not-started': 'Not started',
  incomplete: 'Incomplete',
  complete: 'Complete',
  archived: 'Archived',
} as const;

export const CATEGORY_WORDS = {
  income: { tab: 'Income', lower: 'income', one: 'income item', add: 'Add income' },
  assets: { tab: 'Assets', lower: 'assets', one: 'asset', add: 'Add an asset' },
  liabilities: {
    tab: 'Liabilities',
    lower: 'liabilities',
    one: 'liability',
    add: 'Add a liability',
  },
} as const satisfies Record<Category, { tab: string; lower: string; one: string; add: string }>;

export const TYPE_LABELS: Record<Category, Record<string, string>> = {
  income: INCOME_TYPE_LABELS,
  assets: ASSET_TYPE_LABELS,
  liabilities: LIABILITY_TYPE_LABELS,
};

/** Change kinds offered per category, in the spec's words. */
export const CHANGE_KIND_OPTIONS: Record<Category, { value: ChangeKind; label: string }[]> = {
  income: [
    { value: 'value-change', label: 'Value changed by 25% or more' },
    { value: 'new-source', label: 'New source' },
    { value: 'source-ended', label: 'Source ended' },
  ],
  assets: [
    { value: 'value-change', label: 'Value changed by 25% or more' },
    { value: 'acquisition', label: 'Acquired' },
    { value: 'disposal', label: 'Disposed' },
  ],
  liabilities: [
    { value: 'value-change', label: 'Value changed' },
    // The spec's liability kind "New" has no value of its own in declaration.v1's ChangeFlag
    // enum. A liability taken on since the last declaration is recorded as `acquisition` (the
    // debt was acquired); `new-source` is income's word for a new source of income.
    { value: 'acquisition', label: 'New' },
    { value: 'settled', label: 'Settled' },
  ],
};

/**
 * A change kind in a sentence for an item of this category, e.g. "Changed: new" for a
 * liability. Uses the category's own label, so the summary says what the editor offered.
 */
export function changeWord(category: Category, kind: ChangeKind): string {
  if (kind === 'value-change') return CHANGE_KIND_WORDS[kind];
  const label = CHANGE_KIND_OPTIONS[category].find((option) => option.value === kind)?.label;
  return label ? label.toLowerCase() : CHANGE_KIND_WORDS[kind];
}

/** Options for a SegmentedChoice or Select, in schema order. */
export function optionsOf<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
}
