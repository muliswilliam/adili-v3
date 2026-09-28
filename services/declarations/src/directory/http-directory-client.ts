import { type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import createClient, { type Client } from 'openapi-fetch';
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

/** The scope the declarations service's token needs for the directory's internal API. */
export const DIRECTORY_INTERNAL_SCOPE = 'directory:internal';

export interface HttpDirectoryClientOptions {
  /** Base URL of the directory service, e.g. `http://localhost:4001`. */
  directoryUrl: string;
  /** Client credentials tokens of the declarations service carrying `directory:internal`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per call. Default 10 s (a page is up to 1,000 records). */
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

/**
 * The directory's internal API through the client generated from its contract
 * (packages/schemas/internal/directory.yaml → directory-api.gen.ts via `pnpm generate:api`), with
 * answers validated at the boundary: the service's own token (client credentials,
 * `directory:internal`) and the Commission in `X-Acting-Tenant` (ADR-013 §8.1). A 401 is retried
 * once with a fresh token; anything else unexpected is `DirectoryUnavailable`.
 */
export class HttpDirectoryClient extends DirectoryClient {
  private readonly directory: Client<paths>;

  constructor(private readonly options: HttpDirectoryClientOptions) {
    super();
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 10_000;
    this.directory = createClient<paths>({
      baseUrl: options.directoryUrl.replace(/\/$/, ''),
      headers: { accept: 'application/json' },
      fetch: (request) =>
        fetchImpl(new Request(request, { signal: AbortSignal.timeout(timeoutMs) })),
    });
  }

  async listRosterRecords(
    slug: string,
    selector: RosterRecordSelector,
    cursor: string | null,
  ): Promise<PulledRosterRecordPage> {
    const { data } = await this.call('roster records', (authorization) =>
      this.directory.GET('/internal/v1/commissions/{slug}/roster/records', {
        params: {
          path: { slug },
          header: { 'X-Acting-Tenant': slug },
          query: { ...selector, ...(cursor === null ? {} : { cursor }), limit: 1000 },
        },
        headers: { authorization },
      }),
    );
    return parse(rosterRecordPageSchema, data, 'roster record page');
  }

  async getRosterRecord(slug: string, recordId: string): Promise<PulledRosterRecord | null> {
    const { data, status } = await this.call(
      'roster record',
      (authorization) =>
        this.directory.GET('/internal/v1/commissions/{slug}/roster/records/{recordId}', {
          params: { path: { slug, recordId }, header: { 'X-Acting-Tenant': slug } },
          headers: { authorization },
        }),
      [404],
    );
    return status === 404 ? null : parse(rosterRecordSchema, data, 'roster record');
  }

  async getPolicy(slug: string): Promise<PulledPolicy> {
    const { data } = await this.call('policy', (authorization) =>
      this.directory.GET('/internal/v1/commissions/{slug}/policy', {
        params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        headers: { authorization },
      }),
    );
    return parse(policySchema, data, 'policy');
  }

  async getCommission(slug: string): Promise<PulledCommission> {
    const { data } = await this.call('Commission', (authorization) =>
      this.directory.GET('/internal/v1/commissions/{slug}', {
        params: { path: { slug }, header: { 'X-Acting-Tenant': slug } },
        headers: { authorization },
      }),
    );
    return parse(commissionSchema, data, 'Commission');
  }

  /**
   * Makes a request with a bearer token, retrying once with a fresh one after a 401. Statuses
   * other than 200 and `expected` are `DirectoryUnavailable`.
   */
  private async call<T>(
    what: string,
    request: (authorization: string) => Promise<{ data?: T; response: Response }>,
    expected: number[] = [],
  ): Promise<{ data: T | undefined; status: number }> {
    let answer = await this.send(what, request);
    if (answer.response.status === 401) {
      this.options.tokens.invalidate();
      answer = await this.send(what, request);
    }
    const { status } = answer.response;
    if (status !== 200 && !expected.includes(status)) {
      throw new DirectoryUnavailable(`The directory answered ${String(status)} for the ${what}`);
    }
    return { data: answer.data, status };
  }

  private async send<T>(
    what: string,
    request: (authorization: string) => Promise<{ data?: T; response: Response }>,
  ): Promise<{ data?: T; response: Response }> {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw new DirectoryUnavailable('No service token for the directory', { cause: error });
      }
      throw error;
    }
    try {
      return await request(`Bearer ${token}`);
    } catch (error) {
      throw new DirectoryUnavailable(`The directory is unreachable (${what})`, { cause: error });
    }
  }
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new DirectoryUnavailable(`The directory answered a ${what} that breaks its contract`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
