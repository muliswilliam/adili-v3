import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { rejectedBy } from '../internal-api/rejected.js';
import type { components, paths } from './documents-api.gen.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
  type RevocationReason,
  type UploadDownload,
} from './documents-client.js';

export interface HttpDocumentsClientOptions {
  documentsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const downloadSchema = z.object({
  downloadUrl: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
  purpose: z.string().min(1),
  fileName: z.string().nullable(),
  sha256: z.string().min(1),
}) satisfies z.ZodType<UploadDownload>;

type IssueDocumentBody = components['schemas']['IssueDocument'];

const issuedSchema = z.object({ id: z.uuid(), verificationId: z.string().min(1) });

/**
 * Rendering and signing a document takes seconds. Issuing runs in a workflow activity, which
 * retries. Recorded in ADR-013 §2 (synchronous budgets).
 */
export const ISSUE_TIMEOUT_MS = 30_000;

/**
 * The documents service's internal API through the client generated from its contract
 * (documents-api.gen.ts) on api-kit's service client, with the review service's own token
 * (`documents:internal`) and the Commission in `X-Acting-Tenant` (ADR-013 §8.1). A request the
 * documents service refuses (an upload that is not clean, an invalid issue request) is
 * `InternalApiRejected`; anything else unexpected is `DocumentsUnavailable`.
 */
export class HttpDocumentsClient extends DocumentsClient {
  private readonly documents: ServiceClient<paths>;
  private readonly issuance: ServiceClient<paths>;

  constructor(options: HttpDocumentsClientOptions) {
    super();
    const client = (timeoutMs: number | undefined) =>
      createServiceClient<paths>({
        baseUrl: options.documentsUrl,
        service: 'documents',
        tokens: options.tokens,
        unavailable: (message, cause) => new DocumentsUnavailable(message, cause),
        timeoutMs,
        fetch: options.fetch,
      });
    this.documents = client(options.timeoutMs);
    this.issuance = client(ISSUE_TIMEOUT_MS);
  }

  async getUploadDownload(uploadId: string, tenant: string): Promise<UploadDownload | null> {
    const found = await this.documents.call(
      (api) =>
        api.GET('/internal/v1/uploads/{id}/download', {
          params: { path: { id: uploadId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      {
        status: 200,
        schema: downloadSchema,
        otherwise: { 404: () => null, 409: rejectedBy('documents') },
      },
    );
    if (found === null) return null;
    const { downloadUrl, expiresAt, purpose, fileName, sha256 } = found;
    return { downloadUrl, expiresAt, purpose, fileName, sha256 };
  }

  async issue(request: IssueDocumentRequest, tenant: string): Promise<IssuedDocument> {
    const issued = await this.issuance.call(
      (api) =>
        api.POST('/internal/v1/documents/issue', {
          params: { header: { 'X-Acting-Tenant': tenant } },
          // The clarification letter joins documents' contract with its template (#156); until
          // then documents refuses it with 400 (InternalApiRejected), which the activity does not
          // retry.
          body: request as unknown as IssueDocumentBody,
        }),
      // 200: issued before (one document per type and subject), answered again.
      { status: [200, 201], schema: issuedSchema, otherwise: { 400: rejectedBy('documents') } },
    );
    return { id: issued.id, verificationId: issued.verificationId };
  }

  async revoke(documentId: string, tenant: string, reason: RevocationReason): Promise<void> {
    await this.documents.call(
      (api) =>
        api.POST('/internal/v1/documents/{documentId}/revoke', {
          params: { path: { documentId }, header: { 'X-Acting-Tenant': tenant } },
          body: { reason },
        }),
      {
        status: 200,
        schema: issuedSchema,
        // Already revoked: what was asked for is done.
        otherwise: { 409: () => null, 400: rejectedBy('documents') },
      },
    );
  }
}
