import type { Completeness, DocumentKind } from '../server/declarations/types';
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
 * The one table of labels for declaration capture (the spec's i18n table): the declaration.v1
 * enumerations in schema order, the statement categories, the change kinds each category
 * offers, and the kinds of document read into the form. Completeness messages are the service's, so they are not here.
 *
 * Each enumeration is keyed by the type generated from the schema (`form.gen.ts`, or the
 * declarations contract for obligation types and completeness), so a value the schema adds is a
 * type error here until it has a label; `labels.test.ts` checks the order. The words themselves
 * are copy and are written, not generated. Every value has an English label and a Swahili slot,
 * empty until the Swahili copy is done (out of scope for spec 05); screens read English.
 */

export interface Label {
  en: string;
  /** Empty until translated. */
  sw: string;
}

type Labels<T extends string> = Record<T, Label>;

function english<T extends string>(labels: Labels<T>): Record<T, string> {
  return Object.fromEntries(
    (Object.entries(labels) as [T, Label][]).map(([value, label]) => [value, label.en]),
  ) as Record<T, string>;
}

const en = (text: string): Label => ({ en: text, sw: '' });

export const LABELS = {
  obligationType: {
    initial: en('Initial'),
    biennial: en('Biennial'),
    final: en('Final'),
  } satisfies Labels<ObligationType>,
  maritalStatus: {
    single: en('Single'),
    married: en('Married'),
    separated: en('Separated'),
    divorced: en('Divorced'),
    widowed: en('Widowed'),
  } satisfies Labels<MaritalStatus>,
  employmentNature: {
    permanent: en('Permanent'),
    temporary: en('Temporary'),
    contract: en('Contract'),
    other: en('Other'),
  } satisfies Labels<EmploymentNature>,
  occupationSector: {
    public: en('Public'),
    private: en('Private'),
    'not-employed': en('Not employed'),
    unknown: en('Unknown'),
  } satisfies Labels<OccupationSector>,
  incomeType: {
    'salary-emoluments': en('Salary and emoluments'),
    allowances: en('Allowances'),
    business: en('Business'),
    rent: en('Rent'),
    'dividends-interest': en('Dividends and interest'),
    pension: en('Pension'),
    farming: en('Farming'),
    consultancy: en('Consultancy'),
    other: en('Other'),
  } satisfies Labels<IncomeType>,
  assetType: {
    land: en('Land'),
    building: en('Building'),
    vehicle: en('Vehicle'),
    securities: en('Securities'),
    shareholding: en('Shareholding'),
    'bank-account': en('Bank account'),
    cash: en('Cash'),
    receivable: en('Money owed to me'),
    other: en('Other'),
  } satisfies Labels<AssetType>,
  liabilityType: {
    mortgage: en('Mortgage'),
    loan: en('Loan'),
    guarantee: en('Guarantee'),
    other: en('Other'),
  } satisfies Labels<LiabilityType>,
  /**
   * Change kinds in a sentence where the category is not known, e.g. a material change in
   * paragraph 9: "value changed".
   */
  changeKind: {
    'value-change': en('value changed'),
    acquisition: en('acquired'),
    disposal: en('disposed'),
    'new-source': en('new source'),
    'source-ended': en('source ended'),
    settled: en('settled'),
  } satisfies Labels<ChangeKind>,
  membershipKind: {
    company: en('Company'),
    partnership: en('Partnership'),
    society: en('Society'),
    club: en('Club'),
    foundation: en('Foundation'),
    trust: en('Trust'),
    other: en('Other'),
  } satisfies Labels<MembershipKind>,
  /** Completeness in words, as the section list and navigation show it. */
  completeness: {
    'not-started': en('Not started'),
    incomplete: en('Incomplete'),
    complete: en('Complete'),
    archived: en('Archived'),
  } satisfies Labels<Completeness>,
  /** What a document read into the form is (spec 05b), in the order the sheet offers them. */
  documentKind: {
    'title-deed': en('Title deed'),
    logbook: en('Logbook'),
    payslip: en('Payslip'),
    'bank-letter': en('Bank letter'),
    'share-certificate': en('Share certificate'),
    other: en('Other'),
  } satisfies Labels<DocumentKind>,
};

export const OBLIGATION_TYPE_LABELS = english(LABELS.obligationType);
export const MARITAL_STATUS_LABELS = english(LABELS.maritalStatus);
export const EMPLOYMENT_NATURE_LABELS = english(LABELS.employmentNature);
export const OCCUPATION_SECTOR_LABELS = english(LABELS.occupationSector);
export const INCOME_TYPE_LABELS = english(LABELS.incomeType);
export const ASSET_TYPE_LABELS = english(LABELS.assetType);
export const LIABILITY_TYPE_LABELS = english(LABELS.liabilityType);
export const CHANGE_KIND_WORDS = english(LABELS.changeKind);
export const MEMBERSHIP_KIND_LABELS = english(LABELS.membershipKind);
export const COMPLETENESS_LABELS = english(LABELS.completeness);
export const DOCUMENT_KIND_LABELS = english(LABELS.documentKind);

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
