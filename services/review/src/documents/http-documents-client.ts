import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
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
}) satisfies z.ZodType<UploadDownload>;

const issuedSchema = z.object({ id: z.uuid(), verificationId: z.string().min(1) });

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
    return found === null ? null : { downloadUrl: found.downloadUrl, expiresAt: found.expiresAt };
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
}
