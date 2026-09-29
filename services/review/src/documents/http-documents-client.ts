import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi, InternalApiRejected } from '../internal-api/internal-api.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssuedDocumentFacts,
  type IssueDocumentRequest,
  type RevocationReason,
  type UploadDownload,
} from './documents-client.js';

/** The scope the review service's token needs for the documents internal API. */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

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

const issuedSchema = z.object({ id: z.uuid(), verificationId: z.string().min(1) });

const documentFactsSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const CONFLICT = 409;

/** Rendering and signing a document takes seconds. */
const ISSUE_TIMEOUT_MS = 30_000;

/**
 * The documents service's internal API with the review service's own token
 * (`documents:internal`) and the Commission in `X-Acting-Tenant`.
 */
export class HttpDocumentsClient extends DocumentsClient {
  private readonly api: InternalApi;
  private readonly issuance: InternalApi;

  constructor(options: HttpDocumentsClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.documentsUrl,
      service: 'documents',
      tokens: options.tokens,
      unavailable: (message, cause) => new DocumentsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? 2_000,
      fetch: options.fetch,
    });
    this.issuance = new InternalApi({
      baseUrl: options.documentsUrl,
      service: 'documents',
      tokens: options.tokens,
      unavailable: (message, cause) => new DocumentsUnavailable(message, cause),
      timeoutMs: ISSUE_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  async getUploadDownload(uploadId: string, tenant: string): Promise<UploadDownload | null> {
    const found = await this.api.get({
      path: `internal/v1/uploads/${encodeURIComponent(uploadId)}/download`,
      tenant,
      schema: downloadSchema,
    });
    if (found === null) return null;
    const { downloadUrl, expiresAt, purpose, fileName, sha256 } = found;
    return { downloadUrl, expiresAt, purpose, fileName, sha256 };
  }

  async issue(request: IssueDocumentRequest): Promise<IssuedDocument> {
    const issued = await this.issuance.post({
      path: 'internal/v1/documents/issue',
      tenant: request.issuerTenant,
      body: request,
      schema: issuedSchema,
    });
    if (!issued) throw new DocumentsUnavailable('The documents service answered 404');
    return { id: issued.id, verificationId: issued.verificationId };
  }

  async getIssuedDocument(documentId: string, tenant: string): Promise<IssuedDocumentFacts | null> {
    const found = await this.api.get({
      path: `internal/v1/documents/${encodeURIComponent(documentId)}`,
      tenant,
      schema: documentFactsSchema,
    });
    if (found === null) return null;
    return { id: found.id, type: found.type, sha256: found.sha256 };
  }

  async revoke(documentId: string, tenant: string, reason: RevocationReason): Promise<void> {
    try {
      const revoked = await this.api.post({
        path: `internal/v1/documents/${encodeURIComponent(documentId)}/revoke`,
        tenant,
        body: { reason },
        schema: issuedSchema,
      });
      if (!revoked) throw new DocumentsUnavailable(`Documents has no document ${documentId}`);
    } catch (error) {
      // Already revoked: what was asked for is done.
      if (error instanceof InternalApiRejected && error.status === CONFLICT) return;
      throw error;
    }
  }
}
