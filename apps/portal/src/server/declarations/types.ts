import type { components } from './schema.gen';

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
export type ObligationStatus = Schemas['ObligationStatus'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type SectionEnvelope = Schemas['SectionEnvelope'];
export type SectionKey = Schemas['SectionKey'];
export type SectionSaveResult = Schemas['SectionSaveResult'];
export type Suggestion = Schemas['Suggestion'];
export type SuggestionSet = Schemas['SuggestionSet'];
export type SuggestionSource = Schemas['SuggestionSource'];
