import { IDEMPOTENCY_KEY_HEADER, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
} from './documents-client.js';

/** The scope the reporting service's token needs for the documents internal API. */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

export interface HttpDocumentsClientOptions {
  documentsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const issuedSchema = z.object({ id: z.uuid(), verificationId: z.string().min(1) });

/**
 * `POST /internal/v1/documents/issue` with the reporting service's own token
 * (`documents:internal`) and the Commission in `X-Acting-Tenant`. Rendering and signing takes
 * seconds.
 */
export class HttpDocumentsClient extends DocumentsClient {
  private readonly api: InternalApi;

  constructor(options: HttpDocumentsClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.documentsUrl,
      service: 'documents',
      tokens: options.tokens,
      unavailable: (message, cause) => new DocumentsUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? 30_000,
      fetch: options.fetch,
    });
  }

  async issue(request: IssueDocumentRequest): Promise<IssuedDocument> {
    const { idempotencyKey, ...body } = request;
    const issued = await this.api.post({
      path: 'internal/v1/documents/issue',
      tenant: request.issuerTenant,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      body,
      schema: issuedSchema,
    });
    if (!issued) throw new DocumentsUnavailable('The documents service answered 404');
    return { id: issued.id, verificationId: issued.verificationId };
  }
}
