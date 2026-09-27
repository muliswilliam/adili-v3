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
  /** Until object storage answers with headers. Default 30 s. */
  headersTimeoutMs?: number;
  /**
   * Longest wait for the next chunk of the file. Only time spent waiting on the network counts,
   * never time the reader spends on a chunk, so a large file read slowly (staging applies
   * backpressure) takes as long as it needs. Default 60 s.
   */
  idleTimeoutMs?: number;
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
    const abort = new AbortController();
    const headersTimer = setTimeout(() => {
      abort.abort(new Error('Object storage sent no headers in time'));
    }, this.options.headersTimeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await this.fetch(downloadUrl, { signal: abort.signal });
    } catch (error) {
      throw new DocumentsUnavailable('Object storage is unreachable', { cause: error });
    } finally {
      clearTimeout(headersTimer);
    }
    if (!response.ok || !response.body) {
      abort.abort();
      throw new DocumentsUnavailable(`Object storage answered ${response.status}`);
    }
    return {
      ...upload,
      body: streamed(response.body, abort, this.options.idleTimeoutMs ?? 60_000),
    };
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

/**
 * The body's chunks. A connection lost part way, or no next chunk within `idleTimeoutMs` of
 * asking for it, surfaces as `DocumentsUnavailable`. The download is aborted however the reader
 * stops.
 */
async function* streamed(
  body: AsyncIterable<Uint8Array>,
  abort: AbortController,
  idleTimeoutMs: number,
): AsyncGenerator<Uint8Array> {
  const chunks = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const idleTimer = setTimeout(() => {
        abort.abort(new Error(`Object storage sent nothing for ${idleTimeoutMs} ms`));
      }, idleTimeoutMs);
      let next: IteratorResult<Uint8Array>;
      try {
        next = await chunks.next();
      } finally {
        clearTimeout(idleTimer);
      }
      if (next.done) return;
      yield next.value;
    }
  } catch (error) {
    throw new DocumentsUnavailable('The download from object storage broke off', {
      cause: error,
    });
  } finally {
    abort.abort();
  }
}
