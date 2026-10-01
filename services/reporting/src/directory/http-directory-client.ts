import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
  type StaffMember,
} from './directory-client.js';

/** The scope the reporting service's token needs for the directory's internal API. */
export const DIRECTORY_INTERNAL_SCOPE = 'directory:internal';

/** How long a Commission is reused before it is pulled again. */
export const COMMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

export interface HttpDirectoryClientOptions {
  directoryUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
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

const staffSchema = z.object({
  items: z.array(z.object({ subject: z.string().min(1), email: z.email() })),
});

const noCommission = (slug: string) => (): never => {
  throw new DirectoryUnavailable(`The directory has no Commission ${slug}`);
};

/**
 * The directory's internal API through the client generated from its contract
 * (packages/schemas/internal/directory.yaml → directory-api.gen.ts via `pnpm generate:api`) on
 * api-kit's service client, with the reporting service's own token (`directory:internal`): a
 * Commission (cached per Commission for a few minutes: a name changes rarely) and its staff by
 * role, acting for the Commission in `X-Acting-Tenant` (ADR-013 §8.7), and the list of every
 * Commission, platform reference data that names no tenant.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly directory: ServiceClient<paths>;
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
    this.ttlMs = options.cacheTtlMs ?? COMMISSION_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async getCommission(slug: string): Promise<CommissionFacts> {
    const cached = this.commissions.get(slug);
    if (cached && cached.until > this.now()) return cached.commission;
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: commissionSchema, otherwise: { 404: noCommission(slug) } },
    );
    const commission = { slug: found.slug, issuerCode: found.issuerCode, name: found.name };
    this.commissions.set(slug, { commission, until: this.now() + this.ttlMs });
    return commission;
  }

  async staffWithRole(slug: string, role: string): Promise<StaffMember[]> {
    const found = await this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/staff', {
          params: { path: { slug }, query: { role }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: staffSchema, otherwise: { 404: noCommission(slug) } },
    );
    return found.items;
  }

  async listCommissions(): Promise<CommissionFacts[]> {
    const found = await this.directory.call((api) => api.GET('/internal/v1/commissions'), {
      status: 200,
      schema: commissionListSchema,
    });
    return found.items.map(({ slug, issuerCode, name }) => ({ slug, issuerCode, name }));
  }
}
