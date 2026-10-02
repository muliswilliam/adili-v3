import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './documents-api.gen.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
} from './documents-client.js';

/** The scope the reporting service's token needs for the documents internal API. */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

/**
 * How long issuing may take: rendering through Gotenberg and PAdES signing take seconds. Recorded
 * in ADR-013 §2; issuing runs in workflow activities, which retry with the same Idempotency-Key.
 */
export const DOCUMENTS_ISSUE_TIMEOUT_MS = 30_000;

export interface HttpDocumentsClientOptions {
  documentsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default `DOCUMENTS_ISSUE_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * The issue request as documents' contract declares it, with the Form M, receipt and NCR
 * payloads (`FormMPayload`, `ComplianceReportReceiptPayload`, `NcrPayload`). Reporting builds
 * them as `FormMV1` and plain records, so the body is cast; documents validates each payload
 * against its template.
 */
type IssueDocumentBody =
  paths['/internal/v1/documents/issue']['post']['requestBody']['content']['application/json'];

const issuedSchema = z.object({ id: z.uuid(), verificationId: z.string().min(1) });

/**
 * Documents' `issueDocument` through the client generated from its contract
 * (packages/schemas/internal/documents.yaml → documents-api.gen.ts via `pnpm generate:api`),
 * with the reporting service's own token (`documents:internal`) and the issuing tenant in
 * `X-Acting-Tenant` (ADR-013 §8.5).
 */
export class HttpDocumentsClient extends DocumentsClient {
  private readonly documents: ServiceClient<paths>;

  constructor(options: HttpDocumentsClientOptions) {
    super();
    this.documents = createServiceClient<paths>({
      baseUrl: options.documentsUrl,
      service: 'documents',
      tokens: options.tokens,
      unavailable: (message, cause) => new DocumentsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? DOCUMENTS_ISSUE_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  async issue(request: IssueDocumentRequest): Promise<IssuedDocument> {
    const { idempotencyKey, ...body } = request;
    const issued = await this.documents.call(
      (api) =>
        api.POST('/internal/v1/documents/issue', {
          params: {
            header: { 'X-Acting-Tenant': request.issuerTenant, 'Idempotency-Key': idempotencyKey },
          },
          body: body as unknown as IssueDocumentBody,
        }),
      {
        status: [200, 201],
        schema: issuedSchema,
        otherwise: refusedWith('documents', [400, 403, 422]),
      },
    );
    return { id: issued.id, verificationId: issued.verificationId };
  }
}
