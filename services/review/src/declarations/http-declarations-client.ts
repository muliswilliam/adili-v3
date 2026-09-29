import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type ObligationFacts,
  type PersonObligation,
  type PreviousVersionRef,
  type PulledVersion,
  type ReadContext,
} from './declarations-client.js';

/** The scope the review service's token needs for the declarations internal API. */
export const DECLARATIONS_INTERNAL_SCOPE = 'declarations:internal';

/** Staff subject on whose behalf content is read (declarations.yaml `internalGetVersionDocument`). */
export const ACTING_SUBJECT_HEADER = 'x-acting-subject';
/** The review case the read is for. */
export const REVIEW_CASE_HEADER = 'x-review-case';

/** Per attempt: a document is one decrypted version. Pulls run in activities, which retry. */
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
 * The declarations service's internal API with the review service's own token
 * (`declarations:internal`) and the Commission in `X-Acting-Tenant`. Every document read names
 * the acting subject and the case, which declarations records in its audit trail (ADR-008).
 */
export class HttpDeclarationsClient extends DeclarationsClient {
  private readonly api: InternalApi;

  constructor(options: HttpDeclarationsClientOptions) {
    super();
    this.api = new InternalApi({
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
    return this.api.get({
      path: `internal/v1/declarations/${encodeURIComponent(declarationId)}/versions/${String(version)}/document`,
      tenant: context.tenant,
      headers: {
        [ACTING_SUBJECT_HEADER]: context.actingSubject,
        ...(context.caseId === undefined ? {} : { [REVIEW_CASE_HEADER]: context.caseId }),
      },
      schema: versionSchema,
    });
  }

  findPreviousVersion(
    personId: string,
    tenant: string,
    beforeVersionId: string,
  ): Promise<PreviousVersionRef | null> {
    return this.api.get({
      path: 'internal/v1/declarations/previous-version',
      query: { personId, tenant, beforeVersionId },
      tenant,
      schema: previousSchema,
    });
  }

  getObligation(obligationId: string, tenant: string): Promise<ObligationFacts | null> {
    return this.api.get({
      path: `internal/v1/obligations/${encodeURIComponent(obligationId)}`,
      tenant,
      schema: obligationSchema,
    });
  }

  async listPersonObligations(personId: string, tenant: string): Promise<PersonObligation[]> {
    const found = await this.api.get({
      path: `internal/v1/persons/${encodeURIComponent(personId)}/obligations`,
      query: { tenant },
      tenant,
      schema: personObligationsSchema,
    });
    return found ?? [];
  }
}
