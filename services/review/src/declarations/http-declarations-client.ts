import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './declarations-api.gen.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type ObligationFacts,
  type PersonObligation,
  type PreviousVersionRef,
  type PulledVersion,
  type ReadContext,
} from './declarations-client.js';

/**
 * Per attempt: a document is one decrypted version. Pulls run in activities, which retry.
 * Recorded in ADR-013 §2 (synchronous budgets).
 */
export const DECLARATIONS_PULL_TIMEOUT_MS = 5_000;

export interface HttpDeclarationsClientOptions {
  declarationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const civilDate = z.iso.date();
const instant = z.iso.datetime({ offset: true });

const versionSchema = z.object({
  declarationId: z.uuid(),
  versionId: z.uuid(),
  version: z.int().positive(),
  personId: z.uuid(),
  rosterRecordId: z.uuid(),
  reportingEntityId: z.uuid().nullable(),
  reference: z.string().min(1),
  type: z.enum(['initial', 'biennial', 'final']),
  statementDate: civilDate,
  submittedAt: instant,
  late: z.boolean(),
  dueDate: civilDate,
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  document: z.record(z.string(), z.unknown()),
  attachments: z.array(
    z.object({
      uploadId: z.uuid(),
      itemId: z.uuid(),
      personKey: z.string(),
      fileName: z.string(),
      sha256: z.string(),
    }),
  ),
}) satisfies z.ZodType<PulledVersion>;

const previousSchema = z.object({
  declarationId: z.uuid(),
  versionId: z.uuid(),
  version: z.int().positive(),
  statementDate: civilDate,
  submittedAt: instant,
}) satisfies z.ZodType<PreviousVersionRef>;

const obligationSchema = z.object({
  obligationId: z.uuid(),
  rosterRecordId: z.uuid(),
  personId: z.uuid().nullable(),
  type: z.enum(['initial', 'biennial', 'final']),
  cycleKey: z.string().min(1),
  dueDate: civilDate,
  status: z.enum(['upcoming', 'due', 'overdue', 'filed', 'cancelled']),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
}) satisfies z.ZodType<ObligationFacts>;

const personObligationsSchema = z.array(
  z.object({
    obligationId: z.uuid(),
    type: z.enum(['initial', 'biennial', 'final']),
    cycleKey: z.string().min(1),
    status: z.enum(['upcoming', 'due', 'overdue', 'filed', 'cancelled']),
    dueDate: civilDate,
    filedAt: instant.nullable(),
    late: z.boolean(),
  }),
) satisfies z.ZodType<PersonObligation[]>;

/**
 * The declarations service's internal API through the client generated from its contract
 * (packages/schemas/internal/declarations.yaml → declarations-api.gen.ts via `pnpm generate:api`)
 * on api-kit's service client: the review service's own token (`declarations:internal`) and the
 * Commission in `X-Acting-Tenant` (ADR-013 §8.1). Every document read names the acting subject and
 * the case, which declarations records in its audit trail (ADR-008). Anything unexpected is
 * `DeclarationsUnavailable`.
 */
export class HttpDeclarationsClient extends DeclarationsClient {
  private readonly declarations: ServiceClient<paths>;

  constructor(options: HttpDeclarationsClientOptions) {
    super();
    this.declarations = createServiceClient<paths>({
      baseUrl: options.declarationsUrl,
      service: 'declarations',
      tokens: options.tokens,
      unavailable: (message, cause) => new DeclarationsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? DECLARATIONS_PULL_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  getVersionDocument(
    declarationId: string,
    version: number,
    context: ReadContext,
  ): Promise<PulledVersion | null> {
    return this.declarations.call(
      (api) =>
        api.GET('/internal/v1/declarations/{declarationId}/versions/{version}/document', {
          params: {
            path: { declarationId, version },
            header: {
              'X-Acting-Tenant': context.tenant,
              'X-Acting-Subject': context.actingSubject,
              ...(context.caseId === undefined ? {} : { 'X-Review-Case': context.caseId }),
            },
          },
        }),
      { status: 200, schema: versionSchema, otherwise: { 404: () => null } },
    );
  }

  findPreviousVersion(
    personId: string,
    tenant: string,
    beforeVersionId: string,
  ): Promise<PreviousVersionRef | null> {
    return this.declarations.call(
      (api) =>
        api.GET('/internal/v1/declarations/previous-version', {
          params: {
            header: { 'X-Acting-Tenant': tenant },
            query: { personId, beforeVersionId },
          },
        }),
      { status: 200, schema: previousSchema, otherwise: { 404: () => null } },
    );
  }

  getObligation(obligationId: string, tenant: string): Promise<ObligationFacts | null> {
    return this.declarations.call(
      (api) =>
        api.GET('/internal/v1/obligations/{obligationId}', {
          params: { path: { obligationId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: obligationSchema, otherwise: { 404: () => null } },
    );
  }

  async listPersonObligations(personId: string, tenant: string): Promise<PersonObligation[]> {
    return this.declarations.call(
      (api) =>
        api.GET('/internal/v1/persons/{personId}/obligations', {
          params: { path: { personId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: personObligationsSchema, otherwise: { 404: () => [] } },
    );
  }
}
