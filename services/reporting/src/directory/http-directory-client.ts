import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
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
});

const staffSchema = z.object({
  items: z.array(z.object({ subject: z.string().min(1), email: z.email() })),
});

/**
 * The directory's `internalGetCommission` (cached per Commission for a few minutes: a name
 * changes rarely) and its staff by role, with the reporting service's own token.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly api: InternalApi;
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
    this.ttlMs = options.cacheTtlMs ?? COMMISSION_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
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

  async staffWithRole(slug: string, role: string): Promise<StaffMember[]> {
    const found = await this.api.get({
      path: `internal/v1/commissions/${encodeURIComponent(slug)}/staff`,
      query: { role },
      tenant: slug,
      schema: staffSchema,
    });
    if (!found) throw new DirectoryUnavailable(`The directory has no Commission ${slug}`);
    return found.items;
  }
}
