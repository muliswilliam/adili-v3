import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  type ClarificationPolicy,
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
} from './directory-client.js';

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

const commissionSchema = z.object({
  slug: z.string(),
  issuerCode: z.string().min(1),
  name: z.string().min(1),
});

/**
 * The directory's `internalGetTenantPolicy` and `internalGetCommission` through the client
 * generated from its contract (directory-api.gen.ts) on api-kit's service client, with the review
 * service's own token (`directory:internal`) and the Commission in `X-Acting-Tenant`. Cached per
 * Commission for a few minutes: a policy or a name changes rarely, and a case's window is fixed
 * when the case is created. Anything unexpected, a 404 included, is `DirectoryUnavailable`.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly directory: ServiceClient<paths>;
  private readonly policies = new Map<string, { policy: ClarificationPolicy; until: number }>();
  private readonly commissions = new Map<string, { commission: CommissionFacts; until: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: HttpDirectoryClientOptions) {
    super();
    this.directory = createServiceClient<paths>({
      baseUrl: options.directoryUrl,
      service: 'directory',
      tokens: options.tokens,
      unavailable: (message, cause) => new DirectoryUnavailable(message, cause),
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
    this.ttlMs = options.cacheTtlMs ?? POLICY_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async getClarificationPolicy(slug: string): Promise<ClarificationPolicy> {
    const cached = this.policies.get(slug);
    if (cached && cached.until > this.now()) return cached.policy;
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/policy', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: policySchema },
    );
    this.policies.set(slug, { policy: found.clarification, until: this.now() + this.ttlMs });
    return found.clarification;
  }

  async getCommission(slug: string): Promise<CommissionFacts> {
    const cached = this.commissions.get(slug);
    if (cached && cached.until > this.now()) return cached.commission;
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: commissionSchema },
    );
    const commission = { slug: found.slug, issuerCode: found.issuerCode, name: found.name };
    this.commissions.set(slug, { commission, until: this.now() + this.ttlMs });
    return commission;
  }
}
