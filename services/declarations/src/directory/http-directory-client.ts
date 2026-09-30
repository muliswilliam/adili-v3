import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  DirectoryClient,
  DirectoryUnavailable,
  type PulledCommission,
  type PulledPolicy,
  type PulledRosterRecord,
  type PulledRosterRecordPage,
  type RosterRecordSelector,
} from './directory-client.js';

/**
 * How long a pull may take: a page is up to 1,000 records. Recorded in ADR-016 (not ADR-013's
 * 2 s default); pulls run in event consumers and workflow activities, which retry.
 */
export const DIRECTORY_PULL_TIMEOUT_MS = 10_000;

export interface HttpDirectoryClientOptions {
  /** Base URL of the directory service, e.g. `http://localhost:4001`. */
  directoryUrl: string;
  /** Client credentials tokens of the declarations service carrying `directory:internal`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `DIRECTORY_PULL_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const civilDate = z.iso.date();

const rosterRecordSchema = z.object({
  id: z.uuid(),
  tenant: z.string(),
  personnelFileNumber: z.string(),
  fullName: z.string(),
  state: z.enum(['not_onboarded', 'onboarded', 'exited']),
  appointmentDate: civilDate.nullable(),
  exitDate: civilDate.nullable(),
  personId: z.uuid().nullable(),
  ofr: z.string().nullable(),
  onboardedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}) satisfies z.ZodType<PulledRosterRecord>;

const rosterRecordPageSchema = z.object({
  items: z.array(rosterRecordSchema),
  nextCursor: z.string().nullable(),
});

const monthDay = z.string().regex(/^\d{2}-\d{2}$/);

const policySchema = z.object({
  id: z.uuid(),
  version: z.int(),
  obligationsStartDate: civilDate,
  initialDueAfterAppointmentDays: z.int(),
  biennial: z.object({ statementDate: monthDay, dueDate: monthDay }),
  finalDueAfterExitDays: z.int(),
  reminderOffsetsDays: z.array(z.int()),
}) satisfies z.ZodType<PulledPolicy>;

const commissionSchema = z.object({
  slug: z.string(),
  issuerCode: z.string(),
  name: z.string(),
}) satisfies z.ZodType<PulledCommission>;

const commissionListSchema = z.object({ items: z.array(commissionSchema) });

/**
 * The directory's internal API through the client generated from its contract
 * (packages/schemas/internal/directory.yaml → directory-api.gen.ts via `pnpm generate:api`) on
 * api-kit's service client: the service's own token (client credentials, `directory:internal`,
 * one retry after a 401), the Commission in `X-Acting-Tenant` (ADR-013 §8.1, ADR-016), answers
 * validated at the boundary. Anything else unexpected is `DirectoryUnavailable`.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly directory: ServiceClient<paths>;

  constructor(options: HttpDirectoryClientOptions) {
    super();
    this.directory = createServiceClient<paths>({
      baseUrl: options.directoryUrl,
      service: 'directory',
      tokens: options.tokens,
      unavailable: (message, cause) => new DirectoryUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? DIRECTORY_PULL_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  listRosterRecords(
    slug: string,
    selector: RosterRecordSelector,
    cursor: string | null,
  ): Promise<PulledRosterRecordPage> {
    return this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/roster/records', {
          params: {
            path: { slug },
            header: { 'X-Acting-Tenant': slug },
            query: { ...selector, ...(cursor === null ? {} : { cursor }), limit: 1000 },
          },
        }),
      { status: 200, schema: rosterRecordPageSchema },
    );
  }

  getRosterRecord(slug: string, recordId: string): Promise<PulledRosterRecord | null> {
    return this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/roster/records/{recordId}', {
          params: { path: { slug, recordId }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: rosterRecordSchema, otherwise: { 404: () => null } },
    );
  }

  getPolicy(slug: string): Promise<PulledPolicy> {
    return this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}/policy', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: policySchema },
    );
  }

  getCommission(slug: string): Promise<PulledCommission> {
    return this.directory.call(
      (api) =>
        api.GET('/internal/v1/commissions/{slug}', {
          params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        }),
      { status: 200, schema: commissionSchema },
    );
  }

  async listCommissions(): Promise<PulledCommission[]> {
    const list = await this.directory.call((api) => api.GET('/internal/v1/commissions'), {
      status: 200,
      schema: commissionListSchema,
    });
    return list.items;
  }
}
