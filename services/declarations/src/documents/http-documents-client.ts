import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './documents-api.gen.js';
import {
  type CleanUpload,
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from './documents-client.js';

/** The scope the declarations service's token needs for the documents internal API. */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

export interface HttpDocumentsClientOptions {
  /** Base URL of the documents service, e.g. `http://localhost:4006`. */
  documentsUrl: string;
  /** Client credentials tokens of the declarations service carrying `documents:internal`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default ADR-013's 2 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** The fields of `InternalUpload` an attachment needs. */
const internalUploadSchema = z.object({
  id: z.uuid(),
  purpose: z.string(),
  state: z.string(),
  uploadedBy: z.string(),
  fileName: z.string().nullable(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  size: z.int().nonnegative().nullable(),
});

/**
 * The documents internal API through the client generated from its contract
 * (packages/schemas/internal/documents.yaml → documents-api.gen.ts via `pnpm generate:api`) on
 * api-kit's service client: the service's own token (client credentials, `documents:internal`),
 * the Commission in `X-Acting-Tenant` (documents answers 404 for another Commission's upload),
 * answers validated at the boundary. The upload is read through the internal metadata read, which
 * is not an audited download.
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
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
  }

  async getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload> {
    const upload = await this.documents.call(
      (api) =>
        api.GET('/internal/v1/uploads/{id}', {
          params: { path: { id: uploadId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: internalUploadSchema, otherwise: this.refusals(uploadId) },
    );
    const { state, sha256, size } = upload;
    if (state !== 'clean') throw new UploadNotClean(uploadId);
    if (sha256 === null || size === null) {
      throw new DocumentsUnavailable(`Documents gave clean upload ${uploadId} no hash or size`);
    }
    return {
      id: upload.id,
      purpose: upload.purpose,
      uploadedBy: upload.uploadedBy,
      fileName: upload.fileName,
      sha256,
      size,
    };
  }

  async markLinked(tenant: string, uploadId: string): Promise<void> {
    await this.documents.call(
      (api) =>
        api.POST('/internal/v1/uploads/{id}/linked', {
          params: { path: { id: uploadId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 204, schema: z.unknown(), otherwise: this.refusals(uploadId) },
    );
  }

  async markUnlinked(tenant: string, uploadId: string): Promise<void> {
    await this.documents.call(
      (api) =>
        api.POST('/internal/v1/uploads/{id}/unlinked', {
          params: { path: { id: uploadId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 204, schema: z.unknown(), otherwise: this.refusals(uploadId) },
    );
  }

  private refusals(uploadId: string) {
    return {
      404: (): never => {
        throw new UploadNotFound(uploadId);
      },
      409: (): never => {
        throw new UploadNotClean(uploadId);
      },
    };
  }
}
