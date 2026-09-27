import { ACTING_TENANT_HEADER, type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import { z } from 'zod';

import {
  DocumentsUnavailable,
  type OpenedRosterUpload,
  type RosterUpload,
  RosterUploads,
  rosterFormatOf,
  UploadNotClean,
  UploadNotFound,
} from './roster-uploads.js';

/** The scope the directory's service token needs for documents' internal API (decision 2). */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

/** `UploadDownload` of packages/schemas/internal/documents.yaml, the fields read here. */
const uploadDownload = z.object({
  id: z.string(),
  purpose: z.string(),
  downloadUrl: z.url(),
  size: z.number().int(),
  fileName: z.string().nullable(),
  detectedType: z.string(),
});

export interface HttpRosterUploadsOptions {
  /** Base URL of the documents service, e.g. `http://localhost:4006`. */
  documentsUrl: string;
  /** Client credentials tokens of the directory carrying `documents:internal`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per call to documents. Default 5 s. */
  timeoutMs?: number;
  /** Reading the whole file from storage. Default 2 minutes. */
  downloadTimeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * Reads roster uploads through the documents service's internal API: the directory's own token
 * (client credentials, `documents:internal`) with the tenant in `X-Acting-Tenant`; documents
 * checks the upload is that tenant's. The file is then streamed from the presigned URL.
 */
export class HttpRosterUploads extends RosterUploads {
  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: HttpRosterUploadsOptions) {
    super();
    this.fetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.documentsUrl.replace(/\/$/, '');
  }

  async describe(tenant: string, uploadId: string): Promise<RosterUpload> {
    const { upload } = await this.download(tenant, uploadId);
    return upload;
  }

  async open(tenant: string, uploadId: string): Promise<OpenedRosterUpload> {
    const { upload, downloadUrl } = await this.download(tenant, uploadId);
    let response: Response;
    try {
      response = await this.fetch(downloadUrl, {
        signal: AbortSignal.timeout(this.options.downloadTimeoutMs ?? 120_000),
      });
    } catch (error) {
      throw new DocumentsUnavailable('Object storage is unreachable', { cause: error });
    }
    if (!response.ok || !response.body) {
      throw new DocumentsUnavailable(`Object storage answered ${response.status}`);
    }
    return { ...upload, body: failingAsUnavailable(response.body) };
  }

  /** Asks documents for a download URL, retrying once with a fresh token after a 401. */
  private async download(
    tenant: string,
    uploadId: string,
  ): Promise<{ upload: RosterUpload; downloadUrl: string }> {
    let response = await this.requestDownload(tenant, uploadId);
    if (response.status === 401) {
      this.options.tokens.invalidate();
      response = await this.requestDownload(tenant, uploadId);
    }
    if (response.status === 404) throw new UploadNotFound(uploadId);
    if (response.status === 409) throw new UploadNotClean(uploadId);
    if (!response.ok) {
      throw new DocumentsUnavailable(`Documents answered ${response.status}`);
    }
    const parsed = uploadDownload.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new DocumentsUnavailable('Documents answered without a valid UploadDownload');
    }
    const body = parsed.data;
    const format = rosterFormatOf(body.detectedType);
    if (body.purpose !== 'roster-import' || format === undefined) {
      throw new UploadNotFound(uploadId);
    }
    return {
      upload: { id: body.id, fileName: body.fileName, format, size: body.size },
      downloadUrl: body.downloadUrl,
    };
  }

  private async requestDownload(tenant: string, uploadId: string): Promise<Response> {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw new DocumentsUnavailable('No service token for the documents service', {
          cause: error,
        });
      }
      throw error;
    }
    try {
      return await this.fetch(
        `${this.baseUrl}/internal/v1/uploads/${encodeURIComponent(uploadId)}/download`,
        {
          headers: { authorization: `Bearer ${token}`, [ACTING_TENANT_HEADER]: tenant },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
        },
      );
    } catch (error) {
      throw new DocumentsUnavailable('The documents service is unreachable', { cause: error });
    }
  }
}

/** The body's chunks; a connection lost part way surfaces as `DocumentsUnavailable`. */
async function* failingAsUnavailable(body: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of body) yield chunk;
  } catch (error) {
    throw new DocumentsUnavailable('The download from object storage broke off', {
      cause: error,
    });
  }
}
