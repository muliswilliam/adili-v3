import {
  ASSET_TYPES,
  AssetItemSchema,
  COUNTIES,
  INCOME_TYPES,
  IncomeItemSchema,
  LIABILITY_TYPES,
  LiabilityItemSchema,
} from '@adili/forms';
import { z } from 'zod';

/**
 * The fields a document can fill on a declaration.v1 statement item (spec 05b): every leaf of the
 * item's schema, by dotted path, typed as declaration.v1 types it, less what a document never says
 * (the item's id and type, its change since the previous declaration, its source and
 * attachments) and the foreign-currency original, which the declarant enters. Asset details are
 * the ones the item's type uses, as the form shows them.
 */

export const STATEMENT_SECTIONS = ['assets', 'income', 'liabilities'] as const;
export type StatementSection = (typeof STATEMENT_SECTIONS)[number];

/** A statement item type, with the section that has it (`other` is in all three). */
export const itemTarget = z.discriminatedUnion('section', [
  z.object({ section: z.literal('assets'), itemType: z.enum(ASSET_TYPES) }),
  z.object({ section: z.literal('income'), itemType: z.enum(INCOME_TYPES) }),
  z.object({ section: z.literal('liabilities'), itemType: z.enum(LIABILITY_TYPES) }),
]);
export type ItemTarget = z.infer<typeof itemTarget>;

const ITEM_SCHEMAS: Record<StatementSection, z.ZodObject> = {
  assets: AssetItemSchema,
  income: IncomeItemSchema,
  liabilities: LiabilityItemSchema,
};

/** Item properties a document does not fill. */
const LEFT_OUT = new Set(['id', 'type', 'change', 'source', 'attachments', 'original']);

/** The asset details each asset type uses (as the portal's item editor offers them). */
const ASSET_DETAILS: Record<(typeof ASSET_TYPES)[number], readonly string[]> = {
  land: ['parcelNumber', 'size'],
  building: ['parcelNumber', 'size'],
  vehicle: ['registration', 'makeModel'],
  securities: ['issuer', 'quantityOrPercent'],
  shareholding: ['issuer', 'quantityOrPercent'],
  'bank-account': ['institution', 'accountType'],
  cash: [],
  receivable: ['debtor'],
  other: [],
};

/** What a field means to the model, where its name and type do not say. */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'value.kesCents': 'The value the document states, in Kenyan shilling cents',
  'amount.kesCents': 'The income the document states for the period, in Kenyan shilling cents',
  'outstanding.kesCents': 'The outstanding balance the document states, in Kenyan shilling cents',
  'location.county': `Kenyan county code: ${COUNTIES.map(({ code, name }) => `${code} ${name}`).join(', ')}`,
  'location.country': 'ISO 3166-1 alpha-2 code, for a location outside Kenya',
  'joint.coOwner': 'The other owners, as the document names them',
};

export interface ItemField {
  /** Dotted path within the item, e.g. `details.registration`. */
  name: string;
  value: z.ZodType;
}

/** Each leaf of `schema` below `prefix`, depth first in declaration order. */
function leaves(schema: z.ZodObject, prefix: string, keep: (path: string) => boolean): ItemField[] {
  const shape: Record<string, z.ZodType> = schema.shape;
  return Object.entries(shape).flatMap(([key, child]): ItemField[] => {
    if (LEFT_OUT.has(key)) return [];
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const inner: z.ZodType = child instanceof z.ZodOptional ? (child.unwrap() as z.ZodType) : child;
    if (inner instanceof z.ZodObject) return leaves(inner, path, keep);
    if (!keep(path)) return [];
    const description = DESCRIPTIONS[path];
    return [{ name: path, value: description ? inner.meta({ description }) : inner }];
  });
}

/** The fields a document can fill on an item of `target`. */
export function itemFields(target: ItemTarget): ItemField[] {
  const details = target.section === 'assets' ? ASSET_DETAILS[target.itemType] : [];
  return leaves(ITEM_SCHEMAS[target.section], '', (path) => {
    if (!path.startsWith('details.')) return true;
    return details.includes(path.slice('details.'.length));
  });
}
