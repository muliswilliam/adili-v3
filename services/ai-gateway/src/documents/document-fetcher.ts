import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { DocumentRef } from '../tasks/task.js';
import { DocumentError } from './document-error.js';

export const DOCUMENT_FETCHER_OPTIONS = Symbol('DOCUMENT_FETCHER_OPTIONS');

export interface DocumentFetcherOptions {
  /** Origins (`scheme://host:port`) a download link may point at: the documents store's. */
  allowedOrigins: readonly string[];
  maxBytes: number;
  timeoutMs: number;
}

/**
 * Fetches the document a task reads from its short-lived download link (spec 05b): only from the
 * documents store's origins, following no redirect, no bigger than `maxBytes`, and only the file
 * whose SHA-256 the request names. Failures are `DocumentError`s that name no content or link.
 */
@Injectable()
export class DocumentFetcher {
  private readonly origins: ReadonlySet<string>;

  constructor(@Inject(DOCUMENT_FETCHER_OPTIONS) private readonly options: DocumentFetcherOptions) {
    this.origins = new Set(options.allowedOrigins.map((origin) => new URL(origin).origin));
  }

  async fetch(ref: DocumentRef): Promise<Uint8Array> {
    const url = new URL(ref.downloadUrl);
    if (!this.origins.has(url.origin)) {
      throw new DocumentError('unavailable', `Download links to ${url.origin} are not allowed`);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new DocumentError('unavailable', 'The document could not be fetched', {
        cause: error,
      });
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new DocumentError('unavailable', `The document store answered ${response.status}`);
    }
    const bytes = await this.read(response.body);
    if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) {
      throw new DocumentError('mismatch', 'The document is not the one the request names');
    }
    return bytes;
  }

  /** The body, refusing it once it outgrows `maxBytes`. */
  private async read(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = body.getReader();
    try {
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        size += next.value.byteLength;
        if (size > this.options.maxBytes) {
          throw new DocumentError(
            'too-large',
            `The document is over ${this.options.maxBytes} bytes`,
          );
        }
        chunks.push(next.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof DocumentError) throw error;
      throw new DocumentError('unavailable', 'The document could not be read in full', {
        cause: error,
      });
    }
    return Buffer.concat(chunks);
  }
}
