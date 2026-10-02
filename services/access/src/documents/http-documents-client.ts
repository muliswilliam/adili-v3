import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './documents-api.gen.js';
import {
  type CleanUpload,
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
  type UploadDownload,
  UploadNotClean,
  UploadNotFound,
} from './documents-client.js';

/**
 * How long issuing may take: rendering through Gotenberg and PAdES signing take seconds. Recorded
 * in ADR-013 §2; issuing runs in workflow activities, which retry with the same Idempotency-Key.
 */
export const DOCUMENTS_ISSUE_TIMEOUT_MS = 30_000;

export interface HttpDocumentsClientOptions {
  documentsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt of an upload call. Default ADR-013's 2 s. */
  timeoutMs?: number;
  /** Per attempt of an issue. Default `DOCUMENTS_ISSUE_TIMEOUT_MS`. */
  issueTimeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** The fields of `IssuedDocument` the access service keeps. */
const issuedSchema = z.object({
  id: z.uuid(),
  verificationId: z.string().min(1),
  issuedAt: z.iso.datetime({ offset: true }),
  downloadExpiresAt: z.iso.datetime({ offset: true }).nullable(),
});

/** The fields of `InternalUpload` an attachment needs. */
const internalUploadSchema = z.object({
  id: z.uuid(),
  purpose: z.string(),
  state: z.string(),
  uploadedBy: z.string(),
  fileName: z.string().nullable(),
});

const uploadDownloadSchema = z.object({
  downloadUrl: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});

/**
 * The documents internal API through the client generated from its contract
 * (packages/schemas/internal/documents.yaml → documents-api.gen.ts via `pnpm generate:api`),
 * with the access service's own token (`documents:internal`) and the Commission in
 * `X-Acting-Tenant` (ADR-013 §8.8).
 */
export class HttpDocumentsClient extends DocumentsClient {
  private readonly documents: ServiceClient<paths>;
  private readonly issuing: ServiceClient<paths>;

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
    this.issuing = client(options.issueTimeoutMs ?? DOCUMENTS_ISSUE_TIMEOUT_MS);
  }

  async issue(request: IssueDocumentRequest): Promise<IssuedDocument> {
    const { tenant, idempotencyKey, ...body } = request;
    const issued = await this.issuing.call(
      (api) =>
        api.POST('/internal/v1/documents/issue', {
          params: { header: { 'X-Acting-Tenant': tenant, 'Idempotency-Key': idempotencyKey } },
          body,
        }),
      {
        status: [200, 201],
        schema: issuedSchema,
        otherwise: refusedWith('documents', [400, 403, 422]),
      },
    );
    return {
      id: issued.id,
      verificationId: issued.verificationId,
      issuedAt: new Date(issued.issuedAt),
      downloadExpiresAt:
        issued.downloadExpiresAt === null ? null : new Date(issued.downloadExpiresAt),
    };
  }

  async getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload> {
    const upload = await this.documents.call(
      (api) =>
        api.GET('/internal/v1/uploads/{id}', {
          params: { path: { id: uploadId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: internalUploadSchema, otherwise: this.refusals(uploadId) },
    );
    if (upload.state !== 'clean') throw new UploadNotClean(uploadId);
    const { id, purpose, uploadedBy, fileName } = upload;
    return { id, purpose, uploadedBy, fileName };
  }

  async uploadDownload(tenant: string, uploadId: string): Promise<UploadDownload> {
    const { downloadUrl, expiresAt } = await this.documents.call(
      (api) =>
        api.GET('/internal/v1/uploads/{id}/download', {
          params: { path: { id: uploadId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: uploadDownloadSchema, otherwise: this.refusals(uploadId) },
    );
    return { downloadUrl, expiresAt };
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
