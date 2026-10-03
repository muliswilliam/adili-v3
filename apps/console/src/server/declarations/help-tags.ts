import type { Assert, Same } from '@adili/ui';

import type { HelpTag, QuestionTheme } from './client';

/**
 * The contract's help tags, grouped as the article editor offers them: the declaration's section
 * kinds, the statement item types, and the corpus topics. Fails to compile when the contract's
 * `HelpTag` list changes and these do not.
 */
export const SECTION_TAGS = ['bio', 'household', 'statement', 'other'] as const;

export const ITEM_TYPE_TAGS = [
  'land',
  'building',
  'vehicle',
  'securities',
  'shareholding',
  'bank-account',
  'cash',
  'receivable',
  'mortgage',
  'loan',
  'guarantee',
  'salary-emoluments',
  'allowances',
  'business',
  'rent',
  'dividends-interest',
  'pension',
  'farming',
  'consultancy',
] as const;

export const TOPIC_TAGS = [
  'filing',
  'due-date',
  'statement-date',
  'income-period',
  'initial',
  'biennial',
  'final',
  'declaration',
  'material-change',
  'spouse',
  'dependent-child',
  'joint',
  'foreign',
  'income',
  'assets',
  'liabilities',
  'employment',
  'directorship',
  'membership',
  'dual-citizenship',
  'pending-cases',
  'registrable-interest',
  'gifts',
  'conflict-of-interest',
  'recusal',
  'responsible-commission',
  'clarification',
  'compliance-report',
  'administrative-action',
  'access',
  'confidentiality',
  'complaints',
  'offence',
  'definition',
] as const;

export const HELP_TAGS = [...SECTION_TAGS, ...ITEM_TYPE_TAGS, ...TOPIC_TAGS] as const;

export type ContractHelpTags = Assert<Same<(typeof HELP_TAGS)[number], HelpTag>>;

/** The contract's question themes, in the order the console lists them. */
export const QUESTION_THEMES = [
  'household-spouses',
  'children',
  'land',
  'vehicles',
  'bank-accounts',
  'shares-businesses',
  'income',
  'loans',
  'material-changes',
  'dates-obligations',
  'assets-abroad',
  'joint-ownership',
  'registrable-interests',
  'using-adili',
  'other',
] as const;

export type ContractQuestionThemes = Assert<Same<(typeof QUESTION_THEMES)[number], QuestionTheme>>;
