export {
  type DeclarationIssue,
  type DeclarationProblems,
  type DeclarationSectionKey,
  declarationIssues,
  type PersonKey,
  sectionContents,
  sectionSchema,
  validateDeclaration,
} from './declaration.js';
export type {
  AssetItem,
  Attachment,
  ChangeFlag,
  Child,
  DeclarationV1,
  IncomeItem,
  ItemSource,
  LiabilityItem,
  Location,
  MaritalStatusChange,
  MaterialChangeEntry,
  Money,
  PersonName,
  RegistrableInterests,
  Spouse,
  Statement,
} from './declaration.v1.gen.js';
export {
  ASSET_TYPES,
  ATTESTATION_TEXT,
  CHANGE_KINDS,
  DECLARATION_TYPES,
  DeclarationSchema,
  EMPLOYMENT_NATURES,
  INCOME_PERIOD_SOURCES,
  INCOME_TYPES,
  ITEM_SOURCE_KINDS,
  LIABILITY_TYPES,
  MARITAL_STATUSES,
  MATERIAL_CHANGE_KINDS,
  MEMBERSHIP_KINDS,
  OCCUPATION_SECTORS,
} from './declaration.v1.zod.gen.js';
export { validateFormK } from './form-k.js';
export type { FormKV1 } from './form-k.v1.gen.js';
export { COUNTIES } from './reference-data.js';
export { type FormValidationError, type FormValidationResult } from './validate.js';
