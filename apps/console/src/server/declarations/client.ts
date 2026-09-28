import type {
  ObligationStatus as SharedObligationStatus,
  ObligationType as SharedObligationType,
  ReminderChannel as SharedReminderChannel,
  ReminderOutcome as SharedReminderOutcome,
} from '@adili/ui';
import createClient, { type Client } from 'openapi-fetch';

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
export type ObligationPage =
  paths['/v1/commissions/{slug}/obligations']['get']['responses'][200]['content']['application/json'];
export type ListObligationsQuery = NonNullable<
  paths['/v1/commissions/{slug}/obligations']['get']['parameters']['query']
>;

/** True when A and B are the same union; for compile-time checks against the contract. */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type Assert<T extends true> = T;

/** Fails to compile when the contract and the shared copy table in @adili/ui drift apart. */
export type ContractMatchesSharedCopy = [
  Assert<Same<ObligationType, SharedObligationType>>,
  Assert<Same<ObligationStatus, SharedObligationStatus>>,
  Assert<Same<ReminderOutcome, SharedReminderOutcome>>,
  Assert<Same<Reminder['channels'][number], SharedReminderChannel>>,
];

/** How long the console waits for the declarations service: its reads are quick. */
export const DECLARATIONS_TIMEOUT_MS = 5_000;

export function createDeclarationsClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
}): DeclarationsClient {
  const fetchImpl = options.fetch ?? fetch;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
    fetch: (request) =>
      fetchImpl(new Request(request, { signal: AbortSignal.timeout(DECLARATIONS_TIMEOUT_MS) })),
  });
}

/** A declarations call's outcome, folded the same way as directory calls (see `callDirectory`). */
export type DeclarationsResult<T> = DirectoryResult<T>;

/** Runs one declarations client call and folds every outcome into a `DeclarationsResult`. */
export const callDeclarations: <T>(
  request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
) => Promise<DeclarationsResult<T>> = callDirectory;
