import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  type ClarificationPolicy,
  type CommissionFacts,
  DEFAULT_LADDER_POLICY,
  DirectoryClient,
  DirectoryUnavailable,
  type LadderPolicy,
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

const windowDays = z.int().positive();

/**
 * The policy's periods the review service reads. The ladder's windows are optional: the directory's
 * policy does not carry them yet, and each one it leaves out takes the spec 08 default.
 */
const policySchema = z.object({
  clarification: z.object({
    issueWindowMonths: z.int().positive(),
    replyWindowDays: windowDays,
  }),
  ladder: z
    .object({
      noticeWindowDays: windowDays.optional(),
      warningWindowDays: windowDays.optional(),
      stoppageWindowDays: windowDays.optional(),
    })
    .optional(),
});

interface ReviewPolicy {
  clarification: ClarificationPolicy;
  ladder: LadderPolicy;
}

const commissionSchema = z.object({
  slug: z.string(),
  issuerCode: z.string().min(1),
  name: z.string().min(1),
});

/**
 * The directory's `internalGetTenantPolicy` (clarification periods, ladder windows) and
 * `internalGetCommission` with the review service's
 * own token, cached per Commission for a few minutes: a policy or a name changes rarely, and a
 * case's window is fixed when the case is created.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly api: InternalApi;
  private readonly policies = new Map<string, { policy: ReviewPolicy; until: number }>();
  private readonly commissions = new Map<string, { commission: CommissionFacts; until: number }>();
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
    return (await this.policy(slug)).clarification;
  }

  async getLadderPolicy(slug: string): Promise<LadderPolicy> {
    return (await this.policy(slug)).ladder;
  }

  private async policy(slug: string): Promise<ReviewPolicy> {
    const cached = this.policies.get(slug);
    if (cached && cached.until > this.now()) return cached.policy;
    const found = await this.api.get({
      path: `internal/v1/commissions/${encodeURIComponent(slug)}/policy`,
      tenant: slug,
      schema: policySchema,
    });
    if (!found) throw new DirectoryUnavailable(`The directory has no policy for ${slug}`);
    const policy: ReviewPolicy = {
      clarification: found.clarification,
      ladder: {
        noticeWindowDays: found.ladder?.noticeWindowDays ?? DEFAULT_LADDER_POLICY.noticeWindowDays,
        warningWindowDays:
          found.ladder?.warningWindowDays ?? DEFAULT_LADDER_POLICY.warningWindowDays,
        stoppageWindowDays:
          found.ladder?.stoppageWindowDays ?? DEFAULT_LADDER_POLICY.stoppageWindowDays,
      },
    };
    this.policies.set(slug, { policy, until: this.now() + this.ttlMs });
    return policy;
  }

  async getCommission(slug: string): Promise<CommissionFacts> {
    const cached = this.commissions.get(slug);
    if (cached && cached.until > this.now()) return cached.commission;
    const found = await this.api.get({
      path: `internal/v1/commissions/${encodeURIComponent(slug)}`,
      tenant: slug,
      schema: commissionSchema,
    });
    if (!found) throw new DirectoryUnavailable(`The directory has no Commission ${slug}`);
    const commission = { slug: found.slug, issuerCode: found.issuerCode, name: found.name };
    this.commissions.set(slug, { commission, until: this.now() + this.ttlMs });
    return commission;
  }
}
