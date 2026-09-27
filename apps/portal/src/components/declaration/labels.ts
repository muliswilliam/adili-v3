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

/**
 * English labels for the declaration.v1 enumerations, in schema order (the spec's i18n table;
 * Swahili is out of scope for spec 05). `labels.test.ts` checks every enum value has one.
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

/** Change kinds in a sentence, e.g. "Changed: value changed". */
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

/** Options for a SegmentedChoice or Select, in schema order. */
export function optionsOf<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
}
