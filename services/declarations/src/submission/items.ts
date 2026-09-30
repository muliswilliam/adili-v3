import type {
  AssetItem,
  DeclarationV1,
  IncomeItem,
  LiabilityItem,
  Location,
  Money,
} from '@adili/forms';

import type { ItemCategory } from './schema.js';

/**
 * The normalised items of a submitted document (ADR-001), pure: one per income, asset and
 * liability of every statement, in document order. The clear fields are what analytics and
 * material-change comparison select by; `description` and `value` are encrypted before they are
 * stored.
 */
export interface DerivedItem {
  personKey: string;
  category: ItemCategory;
  itemId: string;
  type: string;
  inKenya: boolean;
  county: string | null;
  country: string | null;
  isJoint: boolean;
  sharePercent: number | null;
  /** Null when unchanged since the previous declaration. */
  changeKind: string | null;
  description: string;
  value: Money;
}

/** Every item of a document that validated against `declaration.v1`. */
export function deriveItems(document: DeclarationV1): DerivedItem[] {
  return document.statements.flatMap((statement) => [
    ...statement.income.map((item) => incomeItem(statement.personKey, item)),
    ...statement.assets.map((item) => assetItem(statement.personKey, item)),
    ...statement.liabilities.map((item) => liabilityItem(statement.personKey, item)),
  ]);
}

function incomeItem(personKey: string, item: IncomeItem): DerivedItem {
  return {
    ...common(personKey, 'income', item),
    isJoint: false,
    sharePercent: null,
    value: item.amount,
  };
}

function assetItem(personKey: string, item: AssetItem): DerivedItem {
  return {
    ...common(personKey, 'asset', item),
    isJoint: item.joint.isJoint,
    sharePercent: item.joint.isJoint ? (item.joint.sharePercent ?? null) : null,
    value: item.value,
  };
}

function liabilityItem(personKey: string, item: LiabilityItem): DerivedItem {
  return {
    ...common(personKey, 'liability', item),
    isJoint: false,
    sharePercent: null,
    value: item.outstanding,
  };
}

function common(
  personKey: string,
  category: ItemCategory,
  item: IncomeItem | AssetItem | LiabilityItem,
): Pick<
  DerivedItem,
  | 'personKey'
  | 'category'
  | 'itemId'
  | 'type'
  | 'inKenya'
  | 'county'
  | 'country'
  | 'changeKind'
  | 'description'
> {
  return {
    personKey,
    category,
    itemId: item.id,
    type: item.type,
    ...where(item.location),
    changeKind: item.change.changed ? (item.change.kind ?? null) : null,
    description: item.description,
  };
}

function where(location: Location): Pick<DerivedItem, 'inKenya' | 'county' | 'country'> {
  return location.inKenya
    ? { inKenya: true, county: location.county ?? null, country: null }
    : { inKenya: false, county: null, country: location.country ?? null };
}
