import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  type ApplicantFacts,
  type ApplicantVerificationInput,
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
  type RosterCandidateFacts,
  type RosterRecordFacts,
  ROSTER_SEARCH_LIMIT,
  type StaffMember,
} from './directory-client.js';

/** How long a Commission is reused before it is pulled again. */
export const COMMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

export interface HttpDirectoryClientOptions {
  directoryUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Tokens with `directory:applicants`, for applicants' particulars and verifications: personal
   * data, so a scope of its own, apart from the reference data `tokens` read.
   */
  applicantTokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default ADR-013's 2 s. */
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  /** For tests. */
  fetch?: typeof fetch;
}

const commissionSchema = z.object({
  slug: z.string(),
  issuerCode: z.string().min(1),
  name: z.string().min(1),
}) satisfies z.ZodType<CommissionFacts>;

const commissionListSchema = z.object({ items: z.array(commissionSchema) });

const rosterRecordSchema = z.object({
  id: z.uuid(),
  personnelFileNumber: z.string(),
  fullName: z.string(),
  personId: z.uuid().nullish(),
});

const rosterPageSchema = z.object({
  items: z.array(
    rosterRecordSchema.extend({
      designation: z.string().nullable(),
      reportingEntity: z.object({ name: z.string() }).nullable(),
      state: z.string(),
    }),
  ),
});

const staffSchema = z.object({
  items: z.array(z.object({ subject: z.string().min(1), email: z.email() })),
});

const applicantSchema = z.object({
  personId: z.uuid(),
  identityStatus: z.enum(['verified', 'pending-verification']),
});

const none = (): null => null;

/**
 * The directory's internal API through the client generated from its contract
 * (packages/schemas/internal/directory.yaml → directory-api.gen.ts via `pnpm generate:api`) on
 * api-kit's service client, with the access service's own token (`directory:internal`), acting
 * for the Commission in `X-Acting-Tenant` (ADR-013 §8.7). A Commission is cached for a few
 * minutes: a name changes rarely.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly directory: ServiceClient<paths>;
  private readonly applicants: ServiceClient<paths>;
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
    this.applicants = createServiceClient<paths>({
      baseUrl: options.directoryUrl,
      service: 'directory',
      tokens: options.applicantTokens,
      unavailable: (message, cause) => new DirectoryUnavailable(message, cause),
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
    this.ttlMs = options.cacheTtlMs ?? COMMISSION_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async findCommission(slug: string): Promise<CommissionFacts | null> {
    const cached = this.commissions.get(slug);
    if (cached && cached.until > this.now()) return cached.commission;
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: commissionSchema, otherwise: { 404: none } },
    );
    if (found === null) return null;
    const commission = { slug: found.slug, issuerCode: found.issuerCode, name: found.name };
    this.commissions.set(slug, { commission, until: this.now() + this.ttlMs });
    return commission;
  }

  async listCommissions(): Promise<CommissionFacts[]> {
    const found = await this.directory.call((api) => api.GET('/internal/v1/commissions'), {
      status: 200,
      schema: commissionListSchema,
    });
    return found.items.map(({ slug, issuerCode, name }) => ({ slug, issuerCode, name }));
  }

  async rosterRecord(slug: string, recordId: string): Promise<RosterRecordFacts | null> {
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/roster/records/{recordId}', {
          params: { path: { slug, recordId }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: rosterRecordSchema, otherwise: { 404: none } },
    );
    if (found === null) return null;
    const { id, personnelFileNumber, fullName, personId } = found;
    return { id, personnelFileNumber, fullName, personId: personId ?? null };
  }

  async searchRoster(slug: string, search: string): Promise<RosterCandidateFacts[]> {
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/roster/records', {
          params: {
            path: { slug },
            query: { search, limit: ROSTER_SEARCH_LIMIT },
            header: { 'X-Acting-Tenant': slug },
          },
        }),
      { status: 200, schema: rosterPageSchema },
    );
    return found.items.map((item) => ({
      id: item.id,
      personnelFileNumber: item.personnelFileNumber,
      fullName: item.fullName,
      personId: item.personId ?? null,
      designation: item.designation,
      reportingEntityName: item.reportingEntity?.name ?? null,
      state: item.state,
    }));
  }

  async staffWithRole(slug: string, role: string): Promise<StaffMember[]> {
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/staff', {
          params: { path: { slug }, query: { role }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: staffSchema },
    );
    return found.items;
  }

  async applicant(personId: string, tenant: string): Promise<ApplicantFacts | null> {
    const found = await this.applicants.call(
      (api) =>
        api.GET('/internal/v1/applicants/{personId}', {
          params: { path: { personId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: applicantSchema, otherwise: { 404: none } },
    );
    return found === null
      ? null
      : { personId: found.personId, identityStatus: found.identityStatus };
  }

  async verifyApplicantIdentity(input: ApplicantVerificationInput): Promise<ApplicantFacts | null> {
    // A 502 `identity-unavailable` (the account could not be changed, nothing changed) is an
    // outage like any other: the caller retries with the same key.
    const found = await this.applicants.call(
      (api) =>
        api.POST('/internal/v1/applicants/{personId}/identity-verification', {
          params: {
            path: { personId: input.personId },
            header: { 'X-Acting-Tenant': input.tenant, 'Idempotency-Key': input.idempotencyKey },
          },
          body: { verifiedBy: input.verifiedBy },
        }),
      { status: 200, schema: applicantSchema, otherwise: { 404: none } },
    );
    return found === null
      ? null
      : { personId: found.personId, identityStatus: found.identityStatus };
  }
}
