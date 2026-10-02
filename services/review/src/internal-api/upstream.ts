import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

import { DirectoryUnavailable } from '../directory/directory-client.js';
import { DocumentsUnavailable } from '../documents/documents-client.js';

/** The services the review service reads from on a request's behalf. */
export type Upstream = 'declarations' | 'directory' | 'documents' | 'ai-gateway';

/**
 * The problem for a request another service could not serve: type `<upstream>-unavailable`, one
 * title for all. 502 by default (review.yaml); 503 where the contract promises the caller can
 * retry because nothing has changed.
 */
export function upstreamUnavailable(
  upstream: Upstream,
  detail: string,
  status: HttpStatus.BAD_GATEWAY | HttpStatus.SERVICE_UNAVAILABLE = HttpStatus.BAD_GATEWAY,
): ProblemException {
  return new ProblemException({
    type: `${upstream}-unavailable`,
    title: 'Upstream service unavailable',
    status,
    detail,
  });
}

/**
 * Runs `call` and turns an outage of the directory or documents service into a 503 the caller
 * can retry: the change the call belongs to has not been made.
 */
export async function withUpstream<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof DirectoryUnavailable) {
      throw upstreamUnavailable(
        'directory',
        'The Commission directory cannot be reached. Try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (error instanceof DocumentsUnavailable) {
      throw upstreamUnavailable(
        'documents',
        'The documents service cannot be reached. Try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw error;
  }
}

/** A declaration the declarations service could not give: 502. */
export function declarationsUnavailable(
  detail = 'The declaration could not be read from the declarations service. Try again shortly.',
): ProblemException {
  return upstreamUnavailable('declarations', detail);
}
