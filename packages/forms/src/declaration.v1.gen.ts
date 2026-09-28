/* Generated from @adili/schemas/forms/declaration.v1.json by scripts/generate-types.ts. Do not edit. */

/**
 * Paragraph 8 for one person
 */
export type Statement = {
  personKey: PersonKey;
  personName: PersonName;
  statementDate: string;
  incomePeriod: {
    from: string;
    to: string;
  };
  incomeNil: boolean;
  income: IncomeItem[];
  assetsNil: boolean;
  assets: AssetItem[];
  liabilitiesNil: boolean;
  liabilities: LiabilityItem[];
  /**
   * For a separated spouse: extent to which the officer knows their affairs
   */
  knowledgeLimitation?: string;
};
export type PersonKey = string;

/**
 * One declaration as submitted by a public officer: paragraphs 1-9 of the First Schedule. Amounts are integers in minor units (KES cents). Draft: spec 05.
 */
export interface DeclarationV1 {
  schemaVersion: 'declaration.v1';
  type: 'initial' | 'biennial' | 'final';
  statementDate: string;
  incomePeriod: {
    from: string;
    to: string;
    /**
     * declared: previous statement date from an Adili declaration; assumed: no prior record on Adili, start derived from type
     */
    fromSource: 'declared' | 'assumed';
  };
  /**
   * Paragraphs 1-5
   */
  officer: {
    name: PersonName;
    birth: {
      date: string;
      place: string;
    };
    maritalStatus: 'single' | 'married' | 'separated' | 'divorced' | 'widowed';
    maritalStatusChange?: MaritalStatusChange;
    address: {
      postal: string;
      physical: string;
    };
    employment: {
      designation: string;
      employer: string;
      nature: 'permanent' | 'temporary' | 'contract' | 'other';
      natureOther?: string;
      /**
       * Tenant key of the Responsible Commission
       */
      responsibleCommission: string;
      personnelFileNumber?: string;
    };
  };
  /**
   * Paragraph 6
   */
  spouses: {
    /**
     * Explicit declaration that there is no spouse
     */
    none: boolean;
    items: Spouse[];
  };
  /**
   * Paragraph 7
   */
  children: {
    /**
     * Explicit declaration that there are no dependent children under 18
     */
    none: boolean;
    items: Child[];
  };
  /**
   * Paragraph 8: one financial statement per person (officer, each spouse, each included child)
   *
   * @minItems 1
   */
  statements: Statement[];
  /**
   * Paragraph 9; material changes per Regs r.21
   */
  otherInformation: {
    /**
     * Composed from flagged items and the marital status change
     */
    materialChanges: MaterialChangeEntry[];
    registrableInterests: RegistrableInterests;
    freeText: string;
  };
  attestation: {
    text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.';
    declaredAt?: string;
    /**
     * Reference number issued at submission (slice 06)
     */
    reference?: string;
  };
}
export interface PersonName {
  surname: string;
  firstName: string;
  otherNames?: string;
}
export interface MaritalStatusChange {
  changed: boolean;
  explanation?: string;
}
export interface Spouse {
  id: string;
  name: PersonName;
  nationalId?: string;
  kraPin?: string;
  occupationSector?: 'public' | 'private' | 'not-employed' | 'unknown';
  separated: boolean;
  separationDate?: string;
}
export interface Child {
  id: string;
  name: PersonName;
  dateOfBirth: string;
  nationalId?: string;
  /**
   * True when under 18 on the statement date; derived, not entered
   */
  includedAtStatementDate: boolean;
}
export interface IncomeItem {
  id: string;
  type:
    | 'salary-emoluments'
    | 'allowances'
    | 'business'
    | 'rent'
    | 'dividends-interest'
    | 'pension'
    | 'farming'
    | 'consultancy'
    | 'other';
  description: string;
  amount: Money;
  location: Location;
  change: ChangeFlag;
  source?: ItemSource;
  attachments?: Attachment[];
}
export interface Money {
  /**
   * Approximate value in Kenyan shilling cents
   */
  kesCents: number;
  /**
   * Original currency and amount for holdings outside Kenya (note 13); no conversion is performed
   */
  original?: {
    currency: string;
    minorUnits: number;
  };
}
export interface Location {
  inKenya: boolean;
  /**
   * Kenyan county code 001-047 when inKenya
   */
  county?: string;
  /**
   * ISO 3166-1 alpha-2 when outside Kenya
   */
  country?: string;
  detail?: string;
}
/**
 * Act s.31(3)-(4): change since the previous declaration
 */
export interface ChangeFlag {
  changed: boolean;
  kind?: 'value-change' | 'acquisition' | 'disposal' | 'new-source' | 'source-ended' | 'settled';
  explanation?: string;
}
/**
 * Where a pre-filled item came from (spec 05b); absent for manually entered items
 */
export interface ItemSource {
  kind: 'kra' | 'ntsa' | 'brs' | 'ardhisasa' | 'document';
  suggestionId: string;
  verificationResultId?: string;
  aiJobId?: string;
  at: string;
}
export interface Attachment {
  /**
   * The link's id, set by the declarations service when it links the upload; unlinking takes it
   */
  attachmentId: string;
  uploadId: string;
  fileName: string;
  sha256: string;
}
export interface AssetItem {
  id: string;
  type:
    | 'land'
    | 'building'
    | 'vehicle'
    | 'securities'
    | 'shareholding'
    | 'bank-account'
    | 'cash'
    | 'receivable'
    | 'other';
  description: string;
  /**
   * Type-specific identifiers; no account numbers
   */
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
  location: Location;
  joint: {
    isJoint: boolean;
    sharePercent?: number;
    coOwner?: string;
  };
  change: ChangeFlag;
  source?: ItemSource;
  attachments?: Attachment[];
}
export interface LiabilityItem {
  id: string;
  type: 'mortgage' | 'loan' | 'guarantee' | 'other';
  description: string;
  creditor: string;
  outstanding: Money;
  location: Location;
  change: ChangeFlag;
  source?: ItemSource;
  attachments?: Attachment[];
}
export interface MaterialChangeEntry {
  personKey?: PersonKey;
  itemId?: string;
  itemDescription?: string;
  kind:
    | 'value-change'
    | 'acquisition'
    | 'disposal'
    | 'new-source'
    | 'source-ended'
    | 'settled'
    | 'marital-status'
    | 'directorship'
    | 'membership';
  explanation: string;
}
/**
 * Second Schedule vocabulary relevant to paragraph 9
 */
export interface RegistrableInterests {
  directorships: {
    company: string;
    role: string;
    remunerated: boolean;
    change?: ChangeFlag;
  }[];
  memberships: {
    entity: string;
    kind: 'company' | 'partnership' | 'society' | 'club' | 'foundation' | 'trust' | 'other';
    change?: ChangeFlag;
  }[];
  dualCitizenship: {
    holds: boolean;
    country?: string;
    pendingApplication: boolean;
  };
  pendingCases: {
    forum: string;
    reference: string;
    nature: string;
  }[];
}
