import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  type ClarificationPolicy,
  type CommissionFacts,
  DEFAULT_LADDER_POLICY,
  DirectoryClient,
  DirectoryUnavailable,
  type LadderPolicy,
  type PayrollRosterFacts,
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
 * The roster record's fields payroll needs. `employerCode` is optional: the directory's record
 * does not carry it yet.
 */
const rosterRecordSchema = z.object({
  personnelFileNumber: z.string().min(1),
  nationalId: z.string().min(1),
  employerCode: z.string().min(1).nullish(),
  reportingEntity: z.object({ id: z.uuid() }).nullish(),
});

/**
 * The directory's `internalGetTenantPolicy` (clarification periods, ladder windows),
 * `internalGetCommission` and `internalGetRosterRecord` through the client generated from its
 * contract (directory-api.gen.ts) on api-kit's service client, with the review service's own token
 * (`directory:internal`) and the Commission in `X-Acting-Tenant`. A policy and a Commission are
 * cached per Commission for a few minutes: they change rarely, and a case's window is fixed when
 * the case is created. A roster record (payroll's facts) is read uncached, each time. Anything
 * unexpected is `DirectoryUnavailable`.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly directory: ServiceClient<paths>;
  private readonly policies = new Map<string, { policy: ReviewPolicy; until: number }>();
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
    return (await this.policy(slug)).clarification;
  }

  async getLadderPolicy(slug: string): Promise<LadderPolicy> {
    return (await this.policy(slug)).ladder;
  }

  private async policy(slug: string): Promise<ReviewPolicy> {
    const cached = this.policies.get(slug);
    if (cached && cached.until > this.now()) return cached.policy;
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/policy', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: policySchema },
    );
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

  async getRosterRecord(slug: string, recordId: string): Promise<PayrollRosterFacts | null> {
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/roster/records/{recordId}', {
          params: { path: { slug, recordId }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: rosterRecordSchema, otherwise: { 404: () => null } },
    );
    if (!found) return null;
    return {
      personalNumber: found.personnelFileNumber,
      nationalId: found.nationalId,
      employerCode: found.employerCode ?? null,
      reportingEntityId: found.reportingEntity?.id ?? null,
    };
  }
}
