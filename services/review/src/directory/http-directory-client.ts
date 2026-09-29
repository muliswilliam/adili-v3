import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  type ClarificationPolicy,
  DirectoryClient,
  DirectoryUnavailable,
} from './directory-client.js';

/** The scope the review service's token needs for the directory's internal API. */
export const DIRECTORY_INTERNAL_SCOPE = 'directory:internal';

/** How long a Commission's policy is reused before it is pulled again. */
export const POLICY_CACHE_TTL_MS = 5 * 60 * 1000;

export interface HttpDirectoryClientOptions {
  directoryUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  /** For tests. */
  fetch?: typeof fetch;
}

const policySchema = z.object({
  clarification: z.object({
    issueWindowMonths: z.int().positive(),
    replyWindowDays: z.int().positive(),
  }),
});

/**
 * The directory's `internalGetTenantPolicy` with the review service's own token, cached per
 * Commission for a few minutes: a policy changes rarely, and a case's window is fixed when the
 * case is created.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly api: InternalApi;
  private readonly cache = new Map<string, { policy: ClarificationPolicy; until: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: HttpDirectoryClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.directoryUrl,
      service: 'directory',
      tokens: options.tokens,
      unavailable: (message, cause) => new DirectoryUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? 2_000,
      fetch: options.fetch,
    });
    this.ttlMs = options.cacheTtlMs ?? POLICY_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async getClarificationPolicy(slug: string): Promise<ClarificationPolicy> {
    const cached = this.cache.get(slug);
    if (cached && cached.until > this.now()) return cached.policy;
    const found = await this.api.get({
      path: `internal/v1/commissions/${encodeURIComponent(slug)}/policy`,
      tenant: slug,
      schema: policySchema,
    });
    if (!found) throw new DirectoryUnavailable(`The directory has no policy for ${slug}`);
    this.cache.set(slug, { policy: found.clarification, until: this.now() + this.ttlMs });
    return found.clarification;
  }
}
