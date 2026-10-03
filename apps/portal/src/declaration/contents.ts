/**
 * Section body types for the declaration workspace, from the First Schedule's JSON Schema
 * (`packages/schemas/forms/declaration.v1.json`). `form.gen.ts` is generated from it by
 * `pnpm generate` (ADR-0009); this module names the parts each section holds. The declarations
 * contract types section contents as an open object (`SectionContents`), so these are what the
 * workspace reads them as.
 *
 * The complete shapes below are what a submitted declaration holds. A draft section can be
 * missing anything, so the autosaved contents use `Draft<T>`.
 */
import type * as Form from './form.gen';

type DeclarationDocument =
  Form.DeclarationOfIncomeAssetsAndLiabilitiesFirstScheduleConflictOfInterestAct2025;

/**
 * Every value of a schema enumeration, in the order the form lists them. It fails to compile
 * when a value is missing or unknown, so the lists move with the generated types.
 */
export function allOf<T extends string>() {
  return <const A extends readonly T[]>(
    values: A & ([T] extends [A[number]] ? unknown : { missing: Exclude<T, A[number]> }),
  ): A => values;
}

export type ObligationType = DeclarationDocument['type'];

/**
 * Whether a declaration of the type follows an earlier one, so "changed since last declaration"
 * means something: every type but the initial declaration, the officer's first.
 */
export function followsEarlierDeclaration(type: ObligationType): boolean {
  return type !== 'initial';
}

export type PersonName = Form.PersonName;
export type Money = Form.Money;
export type Location = Form.Location;
export type ChangeFlag = Form.ChangeFlag;
export type MaritalStatusChange = Form.MaritalStatusChange;
export type Attachment = Form.Attachment;
export type ItemSource = Form.ItemSource;
export type Spouse = Form.Spouse;
export type Child = Form.Child;
export type IncomeItem = Form.IncomeItem;
export type AssetItem = Form.AssetItem;
export type LiabilityItem = Form.LiabilityItem;

/** `officer`, `spouse:<uuid>` or `child:<uuid>`; the schema's pattern, as a type. */
export type PersonKey = 'officer' | `spouse:${string}` | `child:${string}`;

/** Paragraphs 1-5; the `bio` section. `name`, designation, employer and Commission are locked. */
export type Officer = DeclarationDocument['officer'];

/** Paragraphs 6-7; the `household` section. */
export type Household = Pick<DeclarationDocument, 'spouses' | 'children'>;

/** Paragraph 8 for one person; the `statement:<personKey>` sections. */
export type Statement = Form.Statement & { personKey: PersonKey };

export type MaterialChangeEntry = Form.MaterialChangeEntry & { personKey?: PersonKey };

/** Paragraph 9; the `other` section. `materialChanges` is composed by the service. */
export type OtherInformation = Omit<DeclarationDocument['otherInformation'], 'materialChanges'> & {
  materialChanges: MaterialChangeEntry[];
};

export type MaritalStatus = Officer['maritalStatus'];
export const MARITAL_STATUSES = allOf<MaritalStatus>()([
  'single',
  'married',
  'separated',
  'divorced',
  'widowed',
]);

export type EmploymentNature = Officer['employment']['nature'];
export const EMPLOYMENT_NATURES = allOf<EmploymentNature>()([
  'permanent',
  'temporary',
  'contract',
  'other',
]);

export type OccupationSector = NonNullable<Spouse['occupationSector']>;
export const OCCUPATION_SECTORS = allOf<OccupationSector>()([
  'public',
  'private',
  'not-employed',
  'unknown',
]);

export type IncomeType = IncomeItem['type'];
export const INCOME_TYPES = allOf<IncomeType>()([
  'salary-emoluments',
  'allowances',
  'business',
  'rent',
  'dividends-interest',
  'pension',
  'farming',
  'consultancy',
  'other',
]);

export type AssetType = AssetItem['type'];
export const ASSET_TYPES = allOf<AssetType>()([
  'land',
  'building',
  'vehicle',
  'securities',
  'shareholding',
  'bank-account',
  'cash',
  'receivable',
  'other',
]);

export type LiabilityType = LiabilityItem['type'];
export const LIABILITY_TYPES = allOf<LiabilityType>()(['mortgage', 'loan', 'guarantee', 'other']);

export type ChangeKind = NonNullable<ChangeFlag['kind']>;
export const CHANGE_KINDS = allOf<ChangeKind>()([
  'value-change',
  'acquisition',
  'disposal',
  'new-source',
  'source-ended',
  'settled',
]);

export type MembershipKind = Form.RegistrableInterests['memberships'][number]['kind'];
export const MEMBERSHIP_KINDS = allOf<MembershipKind>()([
  'company',
  'partnership',
  'society',
  'club',
  'foundation',
  'trust',
  'other',
]);

export type ItemSourceKind = ItemSource['kind'];
export const ITEM_SOURCE_KINDS = allOf<ItemSourceKind>()([
  'kra',
  'ntsa',
  'brs',
  'ardhisasa',
  'document',
]);

/** Anything in a draft may be missing. Arrays keep their element type partial too. */
export type Draft<T> = T extends (infer E)[]
  ? Draft<E>[]
  : T extends object
    ? { [K in keyof T]?: Draft<T[K]> }
    : T;

/** Contents of each section as saved in a draft, by section kind. */
export interface SectionContentsByKind {
  bio: Draft<Officer>;
  household: Draft<Household>;
  statement: Draft<Statement>;
  other: Draft<OtherInformation>;
}

export const ATTESTATION_TEXT: DeclarationDocument['attestation']['text'] =
  'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.';
