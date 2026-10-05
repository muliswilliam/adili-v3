import createClient, { type Client } from 'openapi-fetch';

import { resilientFetch } from './http.js';

import type { SeedConfig } from '../config.js';
import type { paths as AccessPaths } from './access-api.gen.js';
import type { paths as AiGatewayPaths } from './ai-gateway-api.gen.js';
import type { paths as DeclarationsPaths } from './declarations-api.gen.js';
import type { paths as DirectoryPaths } from './directory-api.gen.js';
import type { paths as DocumentsPaths } from './documents-api.gen.js';
import type { paths as ReportingPaths } from './reporting-api.gen.js';
import type { paths as ReviewPaths } from './review-api.gen.js';

/** The services' public APIs, typed from their contracts (`packages/schemas/internal`). */
export interface Apis {
  directory: Client<DirectoryPaths>;
  declarations: Client<DeclarationsPaths>;
  review: Client<ReviewPaths>;
  access: Client<AccessPaths>;
  reporting: Client<ReportingPaths>;
  documents: Client<DocumentsPaths>;
  aiGateway: Client<AiGatewayPaths>;
}

/**
 * The APIs as one caller: `token` is sent on every request, or none for public routes. A function
 * is asked on every request, so a client held across a long wait never sends an expired token.
 */
export function apis(config: SeedConfig, token?: string | (() => Promise<string>)): Apis {
  const fetch: typeof resilientFetch =
    typeof token === 'function'
      ? async (input, init) => {
          const request = new Request(input, init);
          request.headers.set('authorization', `Bearer ${await token()}`);
          return resilientFetch(request);
        }
      : resilientFetch;
  const headers = typeof token === 'string' ? { authorization: `Bearer ${token}` } : undefined;
  return {
    directory: createClient<DirectoryPaths>({ baseUrl: config.DIRECTORY_URL, headers, fetch }),
    declarations: createClient<DeclarationsPaths>({
      baseUrl: config.DECLARATIONS_URL,
      headers,
      fetch,
    }),
    review: createClient<ReviewPaths>({ baseUrl: config.REVIEW_URL, headers, fetch }),
    access: createClient<AccessPaths>({ baseUrl: config.ACCESS_URL, headers, fetch }),
    reporting: createClient<ReportingPaths>({ baseUrl: config.REPORTING_URL, headers, fetch }),
    documents: createClient<DocumentsPaths>({ baseUrl: config.DOCUMENTS_URL, headers, fetch }),
    aiGateway: createClient<AiGatewayPaths>({ baseUrl: config.AI_GATEWAY_URL, headers, fetch }),
  };
}

/** A call that failed: the method, path, status and the service's problem details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: unknown,
    what: string,
  ) {
    super(`${what}: ${String(status)} ${JSON.stringify(problem)}`);
  }

  /** The problem's `code` (the services' problem details carry one), if any. */
  get code(): string | undefined {
    const problem = this.problem as { code?: unknown } | null;
    return typeof problem?.code === 'string' ? problem.code : undefined;
  }
}

/**
 * The data of a successful call, or an `ApiError`. `what` names the call in the error, e.g.
 * `create commission jsc`.
 */
export function ok<T>(
  result: { data?: T; error?: unknown; response: Response },
  what: string,
): NonNullable<T> {
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiError(result.response.status, result.error, what);
  }
  return result.data as NonNullable<T>;
}
