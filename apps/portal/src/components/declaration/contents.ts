/**
 * Section body types for the declaration workspace.
 *
 * HAND-WRITTEN from `packages/schemas/forms/declaration.v1.json` (the First Schedule). The
 * declarations contract types section contents as an open object (`SectionContents`), and no
 * JSON Schema to TypeScript generator runs in this repo yet, so keep these in step with the
 * schema by hand; `contents.test.ts` fails when the schema's enums change.
 *
 * The complete shapes below are what a submitted declaration holds. A draft section can be
 * missing anything, so the autosaved contents use `Draft<T>`.
 */

export type ObligationType = 'initial' | 'biennial' | 'final';

export const MARITAL_STATUSES = ['single', 'married', 'separated', 'divorced', 'widowed'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const EMPLOYMENT_NATURES = ['permanent', 'temporary', 'contract', 'other'] as const;
export type EmploymentNature = (typeof EMPLOYMENT_NATURES)[number];

export const OCCUPATION_SECTORS = ['public', 'private', 'not-employed', 'unknown'] as const;
export type OccupationSector = (typeof OCCUPATION_SECTORS)[number];

export const INCOME_TYPES = [
  'salary-emoluments',
  'allowances',
  'business',
  'rent',
  'dividends-interest',
  'pension',
  'farming',
  'consultancy',
  'other',
] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];

export const ASSET_TYPES = [
  'land',
  'building',
  'vehicle',
  'securities',
  'shareholding',
  'bank-account',
  'cash',
  'receivable',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const LIABILITY_TYPES = ['mortgage', 'loan', 'guarantee', 'other'] as const;
export type LiabilityType = (typeof LIABILITY_TYPES)[number];

export const CHANGE_KINDS = [
  'value-change',
  'acquisition',
  'disposal',
  'new-source',
  'source-ended',
  'settled',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const MEMBERSHIP_KINDS = [
  'company',
  'partnership',
  'society',
  'club',
  'foundation',
  'trust',
  'other',
] as const;
export type MembershipKind = (typeof MEMBERSHIP_KINDS)[number];

export interface PersonName {
  surname: string;
  firstName: string;
  otherNames?: string;
}

/** `officer`, `spouse:<uuid>` or `child:<uuid>`. */
export type PersonKey = 'officer' | `spouse:${string}` | `child:${string}`;

/** Amounts are integer cents; `original` is the foreign amount in the currency's minor units. */
export interface Money {
  kesCents: number;
  original?: { currency: string; minorUnits: number };
}

export interface Location {
  inKenya: boolean;
  /** `001`-`047`. */
  county?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  detail?: string;
}

export interface ChangeFlag {
  changed: boolean;
  kind?: ChangeKind;
  explanation?: string;
}

export interface MaritalStatusChange {
  changed: boolean;
  explanation?: string;
}

export interface Attachment {
  uploadId: string;
  fileName: string;
  sha256: string;
}

/** Paragraphs 1-5; the `bio` section. `name`, designation, employer and Commission are locked. */
export interface Officer {
  name: PersonName;
  birth: { date: string; place: string };
  maritalStatus: MaritalStatus;
  maritalStatusChange?: MaritalStatusChange;
  address: { postal: string; physical: string };
  employment: {
    designation: string;
    employer: string;
    nature: EmploymentNature;
    natureOther?: string;
    /** The Commission's slug; its name comes from `Declaration.commission`. */
    responsibleCommission: string;
    personnelFileNumber?: string;
    /** Pre-filled from the Commission's roster when it has one; editable. */
    jobGroup?: string;
    /** Date of appointment, ISO date. Pre-filled from the roster when it has one; editable. */
    appointmentDate?: string;
    /** Pre-filled from the roster when it has one; editable. */
    workStation?: string;
  };
}

export interface Spouse {
  id: string;
  name: PersonName;
  nationalId?: string;
  kraPin?: string;
  occupationSector?: OccupationSector;
  separated: boolean;
  separationDate?: string;
}

export interface Child {
  id: string;
  name: PersonName;
  dateOfBirth: string;
  nationalId?: string;
  /** Derived by the service: under 18 on the statement date. */
  includedAtStatementDate: boolean;
}

/** Paragraphs 6-7; the `household` section. */
export interface Household {
  spouses: { none: boolean; items: Spouse[] };
  children: { none: boolean; items: Child[] };
}

export const ITEM_SOURCE_KINDS = ['kra', 'ntsa', 'brs', 'ardhisasa', 'document'] as const;
export type ItemSourceKind = (typeof ITEM_SOURCE_KINDS)[number];

/** Where a pre-filled item came from (spec 05b); absent for items entered by hand. */
export interface ItemSource {
  kind: ItemSourceKind;
  suggestionId: string;
  verificationResultId?: string;
  aiJobId?: string;
  /** When the registry answered or the document was read, ISO date-time. */
  at: string;
}

interface ItemBase {
  id: string;
  description: string;
  location: Location;
  change: ChangeFlag;
  attachments?: Attachment[];
  source?: ItemSource;
}

export interface IncomeItem extends ItemBase {
  type: IncomeType;
  amount: Money;
}

export interface AssetItem extends ItemBase {
  type: AssetType;
  details?: {
    parcelNumber?: string;
    size?: string;
    registration?: string;
    makeModel?: string;
    issuer?: string;
    quantityOrPercent?: string;
    institution?: string;
    accountType?: string;
    debtor?: string;
  };
  value: Money;
  joint: { isJoint: boolean; sharePercent?: number; coOwner?: string };
}

export interface LiabilityItem extends ItemBase {
  type: LiabilityType;
  creditor: string;
  outstanding: Money;
}

/** Paragraph 8 for one person; the `statement:<personKey>` sections. */
export interface Statement {
  personKey: PersonKey;
  personName: PersonName;
  statementDate: string;
  incomePeriod: { from: string; to: string };
  incomeNil: boolean;
  income: IncomeItem[];
  assetsNil: boolean;
  assets: AssetItem[];
  liabilitiesNil: boolean;
  liabilities: LiabilityItem[];
  /** A separated spouse's statement: the extent of the officer's knowledge. */
  knowledgeLimitation?: string;
}

export interface MaterialChangeEntry {
  personKey?: PersonKey;
  itemId?: string;
  itemDescription?: string;
  kind: ChangeKind | 'marital-status' | 'directorship' | 'membership';
  explanation: string;
}

/** Paragraph 9; the `other` section. `materialChanges` is composed by the service. */
export interface OtherInformation {
  materialChanges: MaterialChangeEntry[];
  registrableInterests: {
    directorships: { company: string; role: string; remunerated: boolean; change?: ChangeFlag }[];
    memberships: { entity: string; kind: MembershipKind; change?: ChangeFlag }[];
    dualCitizenship: { holds: boolean; country?: string; pendingApplication: boolean };
    pendingCases: { forum: string; reference: string; nature: string }[];
  };
  freeText: string;
}

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

export const ATTESTATION_TEXT =
  'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.';
