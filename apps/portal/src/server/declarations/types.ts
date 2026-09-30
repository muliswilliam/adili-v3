import type {
  ObligationStatus as SharedObligationStatus,
  ObligationType as SharedObligationType,
  ReminderChannel as SharedReminderChannel,
  ReminderOutcome as SharedReminderOutcome,
} from '@adili/ui';

import type { components, operations } from './schema.gen';

type Schemas = components['schemas'];

export type CommissionRef = Schemas['CommissionRef'];
export type Completeness = Schemas['Completeness'];
export type CompletenessIssue = Schemas['CompletenessIssue'];
export type Declaration = Schemas['Declaration'];
export type DeclarationAttachment = Schemas['DeclarationAttachment'];
export type DeclarationListItem = Schemas['DeclarationListItem'];
export type DeclarationSection = Declaration['sections'][number];
export type DeclarationStatus = Schemas['DeclarationStatus'];
export type DeclarationSummary = Schemas['DeclarationSummary'];
export type MyObligations = Schemas['MyObligations'];
export type Obligation = Schemas['Obligation'];
export type ObligationDetail = Schemas['ObligationDetail'];
export type ObligationGroup = MyObligations['groups'][number];
export type ObligationStatus = Schemas['ObligationStatus'];
export type ObligationType = Schemas['ObligationType'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type Reminder = Schemas['Reminder'];
export type ReminderOutcome = Schemas['ReminderOutcome'];
export type SectionEnvelope = Schemas['SectionEnvelope'];
export type SectionKey = Schemas['SectionKey'];
export type SectionSaveResult = Schemas['SectionSaveResult'];
export type Suggestion = Schemas['Suggestion'];
export type SuggestionSet = Schemas['SuggestionSet'];
export type SuggestionSource = Schemas['SuggestionSource'];

/** The registries a lookup can ask (every `SuggestionSource` but `document`). */
export type RegistrySystem = Exclude<SuggestionSource, 'document'>;

/** What the declarant says a document is, as `extractAttachment` takes it (an inline enum). */
export type DocumentKind =
  operations['extractAttachment']['requestBody']['content']['application/json']['documentKindHint'];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/** Fails to compile when the contract and the shared copy table in @adili/ui drift apart. */
export type ContractMatchesSharedCopy = [
  Assert<Same<ObligationType, SharedObligationType>>,
  Assert<Same<ObligationStatus, SharedObligationStatus>>,
  Assert<Same<ReminderOutcome, SharedReminderOutcome>>,
  Assert<Same<Reminder['channels'][number], SharedReminderChannel>>,
];
