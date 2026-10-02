import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  type AccessPolicy,
  type ApplicantFacts,
  type ApplicantVerificationInput,
  type CommissionFacts,
  type CommissionListing,
  DEFAULT_ACCESS_POLICY,
  DirectoryClient,
  DirectoryUnavailable,
  type LeaOfficerFacts,
  type OnboardingInvitationFacts,
  type RosterCandidateFacts,
  type RosterRecordFacts,
  ROSTER_SEARCH_LIMIT,
  type StaffMember,
  type StaffRole,
} from './directory-client.js';

/** How long a Commission, or its policy, is reused before it is pulled again. */
export const COMMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

export interface HttpDirectoryClientOptions {
  directoryUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Tokens with `directory:applicants`, for applicants' particulars and verifications: personal
   * data, so a scope of its own, apart from the reference data `tokens` read.
   */
  applicantTokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Tokens with `directory:law-enforcement`, for law-enforcement officers' accounts: personal
   * data too, so a scope of its own.
   */
  lawEnforcementTokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
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

const commissionListSchema = z.object({
  items: z.array(
    commissionSchema.extend({ status: z.string().min(1), obligationsStartDate: z.iso.date() }),
  ),
});

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

const invitationSchema = z.object({
  channels: z.array(z.enum(['email', 'sms'])),
  sentAt: z.iso.datetime({ offset: true }),
});

const staffSchema = z.object({
  items: z.array(z.object({ subject: z.string().min(1), email: z.email() })),
});

const applicantSchema = z.object({
  personId: z.uuid(),
  identityStatus: z.enum(['verified', 'pending-verification']),
  fullName: z.string().min(1),
  identityDocument: z.object({
    kind: z.enum(['national-id', 'passport']),
    number: z.string().min(1),
    country: z.string().nullable(),
  }),
  contacts: z.object({ email: z.string().nullable(), phone: z.string().nullable() }),
});

/** The applicant as access holds them: only what it reads, nothing the directory adds. */
function applicantOf(found: z.infer<typeof applicantSchema>): ApplicantFacts {
  const { personId, identityStatus, fullName, identityDocument, contacts } = found;
  return {
    personId,
    identityStatus,
    fullName,
    identityDocument: { ...identityDocument },
    contacts: { email: contacts.email, phone: contacts.phone },
  };
}

const leaOfficerSchema = z.object({
  personId: z.uuid(),
  keycloakUserId: z.string().min(1),
  name: z.string().min(1),
  agency: z.object({ code: z.string().min(1), name: z.string().min(1), legalBasis: z.string() }),
  state: z.enum(['invited', 'activated', 'revoked']),
  activatedAt: z.iso.datetime({ offset: true }).nullable(),
});

const days = z.int().positive();

/**
 * The access periods of a policy version. Each is optional: a directory that predates them leaves
 * them out, and each one missing takes the default.
 */
const policySchema = z.object({
  access: z
    .object({
      decisionDays: days.optional(),
      leaDecisionDays: days.optional(),
      representationWindowDays: days.optional(),
      packageDownloadDays: days.optional(),
    })
    .optional(),
});

const none = (): null => null;

/**
 * The directory's internal API through the client generated from its contract
 * (packages/schemas/internal/directory.yaml → directory-api.gen.ts via `pnpm generate:api`) on
 * api-kit's service client, with the access service's own token (`directory:internal`), acting
 * for the Commission in `X-Acting-Tenant` (ADR-013 §8.8). A Commission and its access periods are
 * cached for a few minutes: they change rarely, and a clock keeps the periods it started with.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly directory: ServiceClient<paths>;
  private readonly applicants: ServiceClient<paths>;
  private readonly lawEnforcement: ServiceClient<paths>;
  private readonly commissions = new Map<string, { commission: CommissionFacts; until: number }>();
  private readonly policies = new Map<string, { policy: AccessPolicy; until: number }>();
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
    this.lawEnforcement = createServiceClient<paths>({
      baseUrl: options.directoryUrl,
      service: 'directory',
      tokens: options.lawEnforcementTokens,
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

  async accessPolicy(slug: string): Promise<AccessPolicy> {
    const cached = this.policies.get(slug);
    if (cached && cached.until > this.now()) return cached.policy;
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/policy', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: policySchema },
    );
    const policy: AccessPolicy = { ...DEFAULT_ACCESS_POLICY };
    for (const key of Object.keys(policy) as (keyof AccessPolicy)[]) {
      policy[key] = found.access?.[key] ?? DEFAULT_ACCESS_POLICY[key];
    }
    this.policies.set(slug, { policy, until: this.now() + this.ttlMs });
    return policy;
  }

  async listCommissions(): Promise<CommissionListing[]> {
    const found = await this.directory.call((api) => api.GET('/internal/v1/commissions'), {
      status: 200,
      schema: commissionListSchema,
    });
    return found.items.map(({ slug, issuerCode, name, status, obligationsStartDate }) => ({
      slug,
      issuerCode,
      name,
      status,
      obligationsStartDate,
    }));
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

  async inviteToOnboard(
    slug: string,
    recordId: string,
    idempotencyKey: string,
  ): Promise<OnboardingInvitationFacts | 'onboarded' | null> {
    const found = await this.directory.call(
      (api) =>
        api.POST(
          '/internal/v1/commissions/{slug}/roster/records/{recordId}/onboarding-invitations',
          {
            params: {
              path: { slug, recordId },
              header: { 'X-Acting-Tenant': slug, 'Idempotency-Key': idempotencyKey },
            },
          },
        ),
      {
        status: 200,
        schema: invitationSchema,
        otherwise: { 404: none, 409: (): 'onboarded' => 'onboarded' },
      },
    );
    if (found === null || found === 'onboarded') return found;
    return { channels: [...found.channels], sentAt: new Date(found.sentAt) };
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

  async staffWithRole(slug: string, role: StaffRole): Promise<StaffMember[]> {
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
    return found === null ? null : applicantOf(found);
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
    return found === null ? null : applicantOf(found);
  }

  async leaOfficer(personId: string, tenant: string): Promise<LeaOfficerFacts | null> {
    const found = await this.lawEnforcement.call(
      (api) =>
        api.GET('/internal/v1/law-enforcement/officers/{personId}', {
          params: { path: { personId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: leaOfficerSchema, otherwise: { 404: none } },
    );
    if (found === null) return null;
    return {
      personId: found.personId,
      keycloakUserId: found.keycloakUserId,
      name: found.name,
      agency: found.agency,
      state: found.state,
      activatedAt: found.activatedAt === null ? null : new Date(found.activatedAt),
    };
  }
}
