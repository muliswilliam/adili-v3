import type { Assert, MatchesObligationCopy } from '@adili/ui';
import { type MockFetch, mockableClient } from '@adili/api-kit/client';
import type { Client } from 'openapi-fetch';

import { callDirectory, type DirectoryResult } from '../directory/client';
import type { components, paths } from './api.gen';

/**
 * Typed client for the declarations API, generated from the committed contract
 * (packages/schemas/internal/declarations.yaml → api.gen.ts via `pnpm generate:api`).
 * Runs on the server only: the browser never holds a token.
 */
export type DeclarationsClient = Client<paths>;

type Schemas = components['schemas'];
export type ObligationType = Schemas['ObligationType'];
export type ObligationStatus = Schemas['ObligationStatus'];
export type ReminderOutcome = Schemas['ReminderOutcome'];
export type Reminder = Schemas['Reminder'];
export type DeclarantRef = Schemas['DeclarantRef'];
export type ObligationListItem = Schemas['ObligationListItem'];
export type ObligationDetail = Schemas['ObligationDetail'];
export type CommissionObligationsSummary = Schemas['CommissionSummary'];
export type StatusCounts = Schemas['StatusCounts'];
export type NationalObligationsSummary = Schemas['NationalSummary'];
export type NationalCommissionRow = NationalObligationsSummary['commissions'][number];
export type DeclarationProgress = Schemas['DeclarationProgress'];
export type ProgressCounts = Schemas['ProgressCounts'];
export type ProgressRow = DeclarationProgress['reportingEntities'][number];
export type ObligationPage =
  paths['/v1/commissions/{slug}/obligations']['get']['responses'][200]['content']['application/json'];
export type HelpTag = Schemas['HelpTag'];
export type HelpArticle = Schemas['HelpArticle'];
export type HelpArticleInput = Schemas['HelpArticleInput'];
export type HelpPassage = Schemas['HelpPassage'];
export type HelpLanguage = Schemas['HelpLanguage'];
export type CorpusPassage = Schemas['CorpusPassage'];
export type CorpusPassageText = Schemas['CorpusPassageText'];
export type CorpusImportResult = Schemas['CorpusImportResult'];
export type QuestionTheme = Schemas['QuestionTheme'];
export type QuestionThemeCount = Schemas['QuestionThemeCount'];
export type ListObligationsQuery = NonNullable<
  paths['/v1/commissions/{slug}/obligations']['get']['parameters']['query']
>;

/** Fails to compile when the contract and the shared copy table in @adili/ui drift apart. */
export type ContractMatchesSharedCopy = Assert<
  MatchesObligationCopy<{
    type: ObligationType;
    status: ObligationStatus;
    outcome: ReminderOutcome;
    channel: Reminder['channels'][number];
  }>
>;

/** How long the console waits for the declarations service: its reads are quick. */
export const DECLARATIONS_TIMEOUT_MS = 5_000;

export function createDeclarationsClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
  /** Answers instead of the service when set (development only; see `mockableClient`). */
  mock?: MockFetch | null;
}): DeclarationsClient {
  return mockableClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}` },
    timeoutMs: DECLARATIONS_TIMEOUT_MS,
    fetch: options.fetch,
    mock: options.mock,
  });
}

/** A declarations call's outcome, folded the same way as directory calls (see `callDirectory`). */
export type DeclarationsResult<T> = DirectoryResult<T>;

/** Runs one declarations client call and folds every outcome into a `DeclarationsResult`. */
export const callDeclarations: <T>(
  request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
) => Promise<DeclarationsResult<T>> = callDirectory;
