import type {
  AssetItem,
  AssetType,
  IncomeType,
  LiabilityType,
  ChangeKind,
  Draft,
  IncomeItem,
  LiabilityItem,
  Money,
  Statement,
} from './contents';
import { blank, countryName, countyName } from './format';
import { ASSET_TYPE_LABELS, INCOME_TYPE_LABELS, LIABILITY_TYPE_LABELS } from './labels';

/**
 * Pure rules for a financial statement (paragraph 8): the three categories, what an item needs
 * before the statement is complete, and the "Also declare for…" copy. Used by the statement
 * screen and by the declarations mock, so both report the same messages.
 */

export type Category = 'income' | 'assets' | 'liabilities';

export const CATEGORIES: readonly Category[] = ['income', 'assets', 'liabilities'];

export type Item = Draft<IncomeItem> | Draft<AssetItem> | Draft<LiabilityItem>;

/** An item of any category, with every field any category has. */
export type AnyItem = Omit<Draft<IncomeItem> & Draft<AssetItem> & Draft<LiabilityItem>, 'type'> & {
  type?: IncomeType | AssetType | LiabilityType;
};

export const NIL_KEY = {
  income: 'incomeNil',
  assets: 'assetsNil',
  liabilities: 'liabilitiesNil',
} as const satisfies Record<Category, keyof Statement>;

/** The field holding an item's KES amount. */
export const AMOUNT_KEY = {
  income: 'amount',
  assets: 'value',
  liabilities: 'outstanding',
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

/** A change kind in a sentence, e.g. "Changed: new" for a liability. */
export function changeWord(category: Category, kind: ChangeKind): string {
  const label = CHANGE_KIND_OPTIONS[category].find((option) => option.value === kind)?.label;
  if (kind === 'value-change') return 'value changed';
  return (label ?? kind).toLowerCase();
}

export type ItemField =
  | 'type'
  | 'description'
  | 'creditor'
  | 'county'
  | 'country'
  | 'amount'
  | 'originalCurrency'
  | 'originalAmount'
  | 'share'
  | 'changeKind'
  | 'explanation';

/** Fields in the order the item editor shows them, so focus goes to the first to fix. */
export const ITEM_FIELD_ORDER: Record<Category, ItemField[]> = {
  income: [
    'type',
    'description',
    'amount',
    'country',
    'originalCurrency',
    'originalAmount',
    'changeKind',
    'explanation',
  ],
  assets: [
    'type',
    'description',
    'county',
    'country',
    'amount',
    'originalCurrency',
    'originalAmount',
    'share',
    'changeKind',
    'explanation',
  ],
  liabilities: [
    'type',
    'description',
    'creditor',
    'amount',
    'country',
    'originalCurrency',
    'originalAmount',
    'changeKind',
    'explanation',
  ],
};

/** JSON pointer of a field within an item, as the service reports issues. */
export function itemFieldPath(category: Category, field: ItemField): string {
  const amount = AMOUNT_KEY[category];
  const paths: Record<ItemField, string> = {
    type: '/type',
    description: '/description',
    creditor: '/creditor',
    county: '/location/county',
    country: '/location/country',
    amount: `/${amount}/kesCents`,
    originalCurrency: `/${amount}/original/currency`,
    originalAmount: `/${amount}/original/minorUnits`,
    share: '/joint/sharePercent',
    changeKind: '/change/kind',
    explanation: '/change/explanation',
  };
  return paths[field];
}

export const ITEM_MESSAGES = {
  type: 'Choose a type.',
  description: 'Enter a short description.',
  creditor: 'Enter who you owe.',
  county: 'Choose the county.',
  country: 'Choose the country.',
  amount: {
    income: 'Enter the approximate amount for the period.',
    assets: 'Enter the approximate value.',
    liabilities: 'Enter the amount outstanding.',
  },
  amountFormat: 'Enter an amount in shillings, e.g. 1,250,000 or 1,250,000.50. No minus signs.',
  originalCurrency: 'Choose the original currency.',
  originalAmount: 'Enter the original amount as a number.',
  share: 'Enter your share as a percentage from 1 to 100.',
  changeKind: 'Choose what changed.',
  explanation: 'Explain the change.',
} as const;

export type ItemIssues = Partial<Record<ItemField, string>>;

function moneyOf(category: Category, item: Item): Draft<Money> | undefined {
  return (item as AnyItem)[AMOUNT_KEY[category]];
}

/**
 * What an item still needs, by field (declaration.v1 items): a type, a description, the
 * creditor of a liability, the county of an asset in Kenya or the country of anything abroad,
 * the KES amount, both halves of an original amount when either is given, a share from 1 to
 * 100 on a joint asset, and the kind and explanation of a flagged change (S9).
 */
export function itemIssues(category: Category, item: Item): ItemIssues {
  const any = item as AnyItem;
  const issues: ItemIssues = {};
  if (!any.type) issues.type = ITEM_MESSAGES.type;
  if (blank(any.description)) issues.description = ITEM_MESSAGES.description;
  if (category === 'liabilities' && blank(any.creditor)) issues.creditor = ITEM_MESSAGES.creditor;

  const abroad = any.location?.inKenya === false;
  if (category === 'assets' && !abroad && !any.location?.county) {
    issues.county = ITEM_MESSAGES.county;
  }
  if (abroad && !any.location?.country) issues.country = ITEM_MESSAGES.country;

  const money = moneyOf(category, item);
  if (money?.kesCents === undefined) issues.amount = ITEM_MESSAGES.amount[category];
  const original = money?.original;
  if (original && (original.currency !== undefined || original.minorUnits !== undefined)) {
    if (!original.currency) issues.originalCurrency = ITEM_MESSAGES.originalCurrency;
    if (original.minorUnits === undefined) issues.originalAmount = ITEM_MESSAGES.originalAmount;
  }

  if (category === 'assets' && any.joint?.isJoint) {
    const share = any.joint.sharePercent;
    if (share === undefined || !(share > 0 && share <= 100)) issues.share = ITEM_MESSAGES.share;
  }

  if (any.change?.changed) {
    if (!any.change.kind) issues.changeKind = ITEM_MESSAGES.changeKind;
    if (blank(any.change.explanation)) issues.explanation = ITEM_MESSAGES.explanation;
  }
  return issues;
}

/** The first issue in screen order, or null when the item is complete. */
export function firstItemIssue(category: Category, item: Item): string | null {
  const issues = itemIssues(category, item);
  const field = ITEM_FIELD_ORDER[category].find((candidate) => issues[candidate]);
  return field ? (issues[field] ?? null) : null;
}

/** An item nothing was entered on yet; closing its editor drops it. */
export function isBlankItem(category: Category, item: Item): boolean {
  const any = item as AnyItem;
  return !any.type && blank(any.description) && moneyOf(category, item)?.kesCents === undefined;
}

export function newItem(category: Category): Item {
  const base = {
    id: crypto.randomUUID(),
    description: '',
    location: { inKenya: true },
    change: { changed: false },
  };
  return category === 'assets' ? { ...base, joint: { isJoint: false } } : base;
}

/** Original-amount currencies offered (the prototype's list); any ISO 4217 code is valid. */
export const CURRENCIES = [
  'USD',
  'GBP',
  'EUR',
  'UGX',
  'TZS',
  'RWF',
  'ZAR',
  'AED',
  'SAR',
  'INR',
  'CNY',
  'CAD',
  'AUD',
  'ETB',
] as const;

/** "USD · US Dollar". */
export function currencyLabel(code: string): string {
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code);
  } catch {
    name = undefined;
  }
  return name && name !== code ? `${code} · ${name}` : code;
}

/** Decimal places of a currency's minor unit: USD 2, UGX 0, KWD 3. */
export function minorUnitsDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * The money input stores hundredths; the schema stores an original amount in the currency's
 * own minor units, so 500,000 UGX (no minor unit) is 500000 and 12.50 KWD is 12500.
 */
export function centsToMinorUnits(cents: number, currency: string): number {
  return Math.round((cents * 10 ** minorUnitsDigits(currency)) / 100);
}

export function minorUnitsToCents(minorUnits: number, currency: string): number {
  return Math.round((minorUnits * 100) / 10 ** minorUnitsDigits(currency));
}

/** Changes an original amount's currency, keeping the amount the declarant typed. */
export function withCurrency(money: Draft<Money>, currency: string): Draft<Money> {
  const original = money.original ?? {};
  const typed =
    original.minorUnits === undefined
      ? undefined
      : minorUnitsToCents(original.minorUnits, original.currency ?? 'USD');
  return {
    ...money,
    original: {
      currency,
      ...(typed === undefined ? {} : { minorUnits: centsToMinorUnits(typed, currency) }),
    },
  };
}

/** The original amount in hundredths, for the money input. */
export function originalCents(money: Draft<Money> | undefined): number | null {
  const original = money?.original;
  if (original?.minorUnits === undefined) return null;
  return minorUnitsToCents(original.minorUnits, original.currency ?? 'USD');
}

/** The line under an item's heading: its description, details and where it is. */
export function itemSummary(category: Category, item: Item): string[] {
  const any = item as AnyItem;
  const details = any.details ?? {};
  const parts: (string | undefined)[] = [any.description?.trim()];
  if (category === 'liabilities') parts.push(any.creditor?.trim());
  if (category === 'assets') {
    parts.push(
      details.parcelNumber,
      details.registration,
      details.makeModel,
      [details.issuer, details.quantityOrPercent].filter(Boolean).join(', '),
      [details.institution, details.accountType].filter(Boolean).join(', '),
      details.debtor ? `Owed by ${details.debtor}` : undefined,
    );
    const county = countyName(any.location?.county);
    parts.push(
      any.location?.inKenya === false
        ? countryName(any.location.country)
        : county
          ? `${county} County`
          : undefined,
    );
  } else if (any.location?.inKenya === false) {
    parts.push(countryName(any.location.country));
  }
  return parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '');
}

/** The sum of a category's KES amounts, and whether any of them is an estimate from abroad. */
export function statementTotal(
  statement: Draft<Statement>,
  category: Category,
): { cents: number; abroad: boolean } {
  const items: Item[] = statement[category] ?? [];
  return {
    cents: items.reduce((sum, item) => sum + (moneyOf(category, item)?.kesCents ?? 0), 0),
    abroad: items.some((item) => item.location?.inKenya === false),
  };
}

/** What a category's tab shows: its item count, or a tick for "Nothing to declare". */
export function tabState(
  statement: Draft<Statement>,
  category: Category,
): { count: number; nil: boolean } {
  return {
    count: statement[category]?.length ?? 0,
    nil: statement[NIL_KEY[category]] === true,
  };
}

/**
 * "Also declare for…" (story 30): the asset becomes jointly held with `myShare` percent, and a
 * copy with the other share goes to the other person's statement. The copy carries no
 * documents and no change flag; those belong to the declarant's own item.
 */
export function jointCopy(
  source: Draft<AssetItem>,
  myShare: number,
): { source: Draft<AssetItem>; copy: Draft<AssetItem> } {
  const joint = { ...source.joint, isJoint: true, sharePercent: myShare };
  const copy: Draft<AssetItem> = {
    ...source,
    id: crypto.randomUUID(),
    joint: { ...joint, sharePercent: 100 - myShare },
    change: { changed: false },
  };
  delete copy.attachments;
  return { source: { ...source, joint }, copy };
}

/** Adds a joint copy to another statement, which then has something to declare. */
export function addJointCopy(target: Draft<Statement>, copy: Draft<AssetItem>): Draft<Statement> {
  return { ...target, assetsNil: false, assets: [...(target.assets ?? []), copy] };
}
