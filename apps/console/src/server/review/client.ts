import createClient, { type Client } from 'openapi-fetch';

import type { components, paths } from './api.gen';

/**
 * Typed client for the review API, generated from the committed contract
 * (packages/schemas/internal/review.yaml → api.gen.ts via `pnpm generate:api`). Runs on the
 * server only: the browser never holds a token. `send` is the in-memory mock in development
 * with REVIEW_MOCK set (see `../clarifications.ts`), else fetch.
 */
export type ReviewClient = Client<paths>;

type Schemas = components['schemas'];
export type Assignee = Schemas['Assignee'];
export type CaseDetail = Schemas['CaseDetail'];
export type CaseListItem = Schemas['CaseListItem'];
export type Clarification = Schemas['Clarification'];
export type ClarificationStatus = Schemas['ClarificationStatus'];
export type Requirement = Schemas['Requirement'];

/** Reads and writes are quick; the issue and withdraw paths wait on documents at most. */
const TIMEOUT_MS = 10_000;

export function createReviewClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: (request: Request) => Promise<Response>;
}): ReviewClient {
  const send = options.fetch ?? fetch;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}
