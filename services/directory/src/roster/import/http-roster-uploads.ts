import { type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import createClient, { type Client } from 'openapi-fetch';

import type { paths } from './documents-api.gen.js';
import {
  DocumentsUnavailable,
  type OpenedRosterUpload,
  type RosterUpload,
  RosterUploads,
  rosterFormatOf,
  type UploadRef,
  UploadNotClean,
  UploadNotFound,
} from './roster-uploads.js';

/** The scope the directory's service token needs for documents' internal API (decision 2). */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

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
 * Reads roster uploads through the documents service's internal API, with the client generated
 * from its contract (packages/schemas/internal/documents.yaml → documents-api.gen.ts via
 * `pnpm generate:api`): the directory's own token (client credentials, `documents:internal`)
 * with the tenant in `X-Acting-Tenant`; documents checks the upload is that tenant's. The file
 * is then streamed from the presigned URL.
 */
export class HttpRosterUploads extends RosterUploads {
  private readonly fetch: typeof fetch;
  private readonly documents: Client<paths>;

  constructor(private readonly options: HttpRosterUploadsOptions) {
    super();
    this.fetch = options.fetch ?? globalThis.fetch;
    const fetchImpl = this.fetch;
    const timeoutMs = options.timeoutMs ?? 5_000;
    this.documents = createClient<paths>({
      baseUrl: options.documentsUrl.replace(/\/$/, ''),
      headers: { accept: 'application/json' },
      fetch: (request) =>
        fetchImpl(new Request(request, { signal: AbortSignal.timeout(timeoutMs) })),
    });
  }

  async describe(ref: UploadRef): Promise<RosterUpload> {
    const { upload } = await this.download(ref);
    return upload;
  }

  async open(ref: UploadRef): Promise<OpenedRosterUpload> {
    const { upload, downloadUrl } = await this.download(ref);
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
  private async download(ref: UploadRef): Promise<{ upload: RosterUpload; downloadUrl: string }> {
    let answer = await this.requestDownload(ref);
    if (answer.response.status === 401) {
      this.options.tokens.invalidate();
      answer = await this.requestDownload(ref);
    }
    const { data, response } = answer;
    if (response.status === 404) throw new UploadNotFound(ref.uploadId);
    if (response.status === 409) throw new UploadNotClean(ref.uploadId);
    if (!data) throw new DocumentsUnavailable(`Documents answered ${String(response.status)}`);
    const format = rosterFormatOf(data.detectedType);
    // Widened: documents' purposes grow with later slices, and only roster imports are rosters.
    const purpose: string = data.purpose;
    if (purpose !== 'roster-import' || format === undefined) {
      throw new UploadNotFound(ref.uploadId);
    }
    return {
      upload: { id: data.id, fileName: data.fileName, format, size: data.size },
      downloadUrl: data.downloadUrl,
    };
  }

  private async requestDownload({ tenant, uploadId }: UploadRef) {
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
      return await this.documents.GET('/internal/v1/uploads/{id}/download', {
        params: { path: { id: uploadId }, header: { 'X-Acting-Tenant': tenant } },
        headers: { authorization: `Bearer ${token}` },
      });
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
