import type { CaseListItem, CaseStatus, Severity } from '../server/review/types';
import type { Tone } from '../clarification/labels';

/**
 * The words of a review case in the console (spec 07a FE-3): its statuses, the declaration
 * types, the severities and the `declaration.v1` enumerations the declaration pane prints. Keyed
 * by the contract's types where it has them, so a value the contract adds is a type error here
 * until it has words. The declaration labels are the portal's capture labels
 * (`apps/portal/src/declaration/labels.ts`), so both apps name an item alike.
 */

export const CASE_STATUSES = {
  unassigned: { label: 'Unassigned', tone: 'neutral' },
  assigned: { label: 'Assigned', tone: 'info' },
  'awaiting-clarification': { label: 'Awaiting clarification', tone: 'warning' },
  clarified: { label: 'Clarified', tone: 'brand' },
  'ready-for-determination': { label: 'Ready for determination', tone: 'success' },
  'sample-review': { label: 'Sample review', tone: 'info' },
  'further-action': { label: 'Further action', tone: 'destructive' },
  determined: { label: 'Determined', tone: 'success' },
} satisfies Record<CaseStatus, { label: string; tone: Tone }>;

export const DECLARATION_TYPES = {
  initial: 'Initial',
  biennial: 'Biennial',
  final: 'Final',
} satisfies Record<CaseListItem['type'], string>;

export const SEVERITY_ORDER: readonly Severity[] = ['high', 'medium', 'low', 'info'];

export const SEVERITY_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
} satisfies Record<Severity, string>;

export const CATEGORY_LABELS = {
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
} as const;

export const RELATION_LABELS = {
  declarant: 'Declarant',
  spouse: 'Spouse',
  child: 'Child',
} as const;

export const MARITAL_STATUS_LABELS: Record<string, string> = {
  single: 'Single',
  married: 'Married',
  separated: 'Separated',
  divorced: 'Divorced',
  widowed: 'Widowed',
};

export const EMPLOYMENT_NATURE_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  temporary: 'Temporary',
  contract: 'Contract',
  other: 'Other',
};

export const INCOME_TYPE_LABELS: Record<string, string> = {
  'salary-emoluments': 'Salary and emoluments',
  allowances: 'Allowances',
  business: 'Business',
  rent: 'Rent',
  'dividends-interest': 'Dividends and interest',
  pension: 'Pension',
  farming: 'Farming',
  consultancy: 'Consultancy',
  other: 'Other income',
};

export const ASSET_TYPE_LABELS: Record<string, string> = {
  land: 'Land',
  building: 'Building',
  vehicle: 'Vehicle',
  securities: 'Securities',
  shareholding: 'Shareholding',
  'bank-account': 'Bank account',
  cash: 'Cash',
  receivable: 'Money owed',
  other: 'Other asset',
};

export const LIABILITY_TYPE_LABELS: Record<string, string> = {
  mortgage: 'Mortgage',
  loan: 'Loan',
  guarantee: 'Guarantee',
  other: 'Other liability',
};
