/**
 * Question themes (spec 11 S8), pure: the fixed list a Commission's anonymised question counts
 * are kept by, and the keyword rules, English and Kiswahili, that map a question to one. The
 * first rule that matches a whole word wins, so the narrower themes (assets outside Kenya, joint
 * ownership) come before the kinds of asset they cut across, and what an item is (income, a loan)
 * before whose it is (a spouse, a child). A question no rule matches is `other`. Only the theme
 * is kept: the question itself never leaves the messages table.
 */

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

export type QuestionTheme = (typeof QUESTION_THEMES)[number];

/** Whole words or phrases, matched on the normalised question (lower case, no accents). */
const words = (...alternatives: string[]): RegExp =>
  new RegExp(`(?:^|[^a-z0-9])(?:${alternatives.join('|')})(?=$|[^a-z0-9])`);

const RULES: readonly (readonly [Exclude<QuestionTheme, 'other'>, RegExp])[] = [
  [
    'using-adili',
    words(
      'sign ?-?in',
      'log ?-?in',
      'password',
      'otp',
      'one-time code',
      'verification code',
      'nenosiri',
      'kuingia',
      'msimbo',
    ),
  ],
  [
    'assets-abroad',
    words(
      'outside kenya',
      'abroad',
      'overseas',
      'foreign',
      'nje ya nchi',
      'nje ya kenya',
      "ng'ambo",
    ),
  ],
  [
    'joint-ownership',
    words('co-?own(?:s|ed|er|ers|ership)?', 'joint(?:ly)?', 'together with', 'pamoja', 'ubia'),
  ],
  [
    'registrable-interests',
    words(
      'director(?:s|ship|ships)?',
      'registrable',
      'board member',
      'trustee',
      'mkurugenzi',
      'wakurugenzi',
      'maslahi',
    ),
  ],
  ['material-changes', words('material changes?', 'changed since', 'what changed', 'mabadiliko')],
  [
    'dates-obligations',
    words(
      'deadline',
      'due date',
      'when (?:is|do|must|should|can)',
      'late (?:filing|declaration|submission)',
      '(?:file|submit) late',
      'statement date',
      'tarehe',
      'lini',
      'mwisho',
      'kuchelewa',
    ),
  ],
  [
    'income',
    words(
      'salary',
      'salaries',
      'income',
      'allowances?',
      'wages?',
      'pension',
      'earn(?:s|ed|ings)?',
      'mshahara',
      'mapato',
      'marupurupu',
      'posho',
    ),
  ],
  [
    'loans',
    words(
      'loans?',
      'mortgages?',
      'liability',
      'liabilities',
      'debts?',
      'owe',
      'overdraft',
      'credit card',
      'mkopo',
      'mikopo',
      'deni',
      'madeni',
    ),
  ],
  [
    'land',
    words(
      'land',
      'plots?',
      'parcels?',
      'title deeds?',
      'buildings?',
      'house',
      'houses',
      'flat',
      'apartments?',
      'property',
      'ardhi',
      'shamba',
      'mashamba',
      'kiwanja',
      'viwanja',
      'nyumba',
      'jengo',
    ),
  ],
  [
    'vehicles',
    words(
      'cars?',
      'vehicles?',
      'matatus?',
      'motorcycles?',
      'motorbikes?',
      'boda(?: ?boda)?',
      'lorry',
      'trucks?',
      'logbook',
      'gari',
      'magari',
      'pikipiki',
    ),
  ],
  [
    'bank-accounts',
    words(
      'banks?',
      'accounts?',
      'm-?pesa',
      'cash',
      'savings',
      'benki',
      'akaunti',
      'akiba',
      'pesa taslimu',
    ),
  ],
  [
    'shares-businesses',
    words(
      'shares?',
      'shareholding',
      'stocks?',
      'sacco',
      'business(?:es)?',
      'company',
      'companies',
      'hisa',
      'biashara',
      'kampuni',
    ),
  ],
  [
    'children',
    words(
      'child',
      'children',
      'sons?',
      'daughters?',
      'dependants?',
      'dependents?',
      'kids?',
      'mtoto',
      'watoto',
      'mwanangu',
    ),
  ],
  [
    'household-spouses',
    words(
      'spouses?',
      'wife',
      'wives',
      'husband',
      'married',
      'marriage',
      'mke',
      'mume',
      'mwenzi',
      'wenzi',
      'ndoa',
    ),
  ],
];

/** The question's theme by the first rule matching it; `other` when none does. */
export function themeOf(question: string): QuestionTheme {
  const normalised = question
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
  return RULES.find(([, rule]) => rule.test(normalised))?.[0] ?? 'other';
}
