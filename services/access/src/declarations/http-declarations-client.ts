import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../upstream-refusal.js';
import type { paths } from './declarations-api.gen.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type DisclosureDocument,
  type DisclosureRequest,
  type FullDocumentRequest,
  type PersonVersion,
  type VersionDocument,
} from './declarations-client.js';

export interface HttpDeclarationsClientOptions {
  declarationsUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Tokens with `declarations:disclosures`, for scoped disclosures and full documents: the
   * declarations decrypted for a third party, which only the access service's token opens.
   */
  disclosureTokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. Default ADR-013's 2 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** The fields of `DisclosureDocument` the access service relies on; the rest passes through. */
const disclosureSchema = z.looseObject({
  schemaVersion: z.literal('disclosure.v1'),
  grantReference: z.string(),
  versions: z.array(z.looseObject({ reference: z.string(), version: z.int() })),
});

/** The fields of `FullVersionDocument` the access service relies on. */
const versionDocumentSchema = z.looseObject({
  declarationId: z.uuid(),
  version: z.int(),
  personId: z.uuid(),
});

/** The fields of `InternalPersonVersion` the access service relies on. */
const personVersionsSchema = z.array(
  z.looseObject({
    declarationId: z.uuid(),
    version: z.int(),
    reference: z.string(),
    statementDate: z.iso.date(),
    submittedAt: z.iso.datetime({ offset: true }),
    superseded: z.boolean(),
  }),
);

const none = (): null => null;

/**
 * The declarations internal API through the client generated from its contract
 * (packages/schemas/internal/declarations.yaml → declarations-api.gen.ts via
 * `pnpm generate:api`), with the access service's own token (`declarations:disclosures` for
 * disclosures and full documents, `declarations:internal` for a declarant's versions), the
 * Commission in `X-Acting-Tenant` and, in `X-Acting-Subject`, the deciding officer (disclosure)
 * or who asked for a certified copy (full document), whom declarations audits the read for; the
 * recipient a read hands the declaration to goes in the body.
 */
export class HttpDeclarationsClient extends DeclarationsClient {
  private readonly declarations: ServiceClient<paths>;
  private readonly disclosures: ServiceClient<paths>;

  constructor(options: HttpDeclarationsClientOptions) {
    super();
    this.declarations = createServiceClient<paths>({
      baseUrl: options.declarationsUrl,
      service: 'declarations',
      tokens: options.tokens,
      unavailable: (message, cause) => new DeclarationsUnavailable(message, cause),
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
    this.disclosures = createServiceClient<paths>({
      baseUrl: options.declarationsUrl,
      service: 'declarations',
      tokens: options.disclosureTokens,
      unavailable: (message, cause) => new DeclarationsUnavailable(message, cause),
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
  }

  async renderDisclosure(request: DisclosureRequest): Promise<DisclosureDocument | null> {
    const { tenant, officerSubject, ...body } = request;
    const disclosure = await this.disclosures.call(
      (api) =>
        api.POST('/internal/v1/declarations/disclosures', {
          params: { header: { 'X-Acting-Tenant': tenant, 'X-Acting-Subject': officerSubject } },
          body,
        }),
      {
        status: 200,
        schema: disclosureSchema,
        otherwise: { 404: none, ...refusedWith('declarations', [400, 403]) },
      },
    );
    return disclosure as DisclosureDocument | null;
  }

  async fullDocument(request: FullDocumentRequest): Promise<VersionDocument | null> {
    const document = await this.disclosures.call(
      (api) =>
        api.POST('/internal/v1/declarations/{declarationId}/versions/{version}/full-document', {
          params: {
            path: { declarationId: request.declarationId, version: request.version },
            header: {
              'X-Acting-Tenant': request.tenant,
              'X-Acting-Subject': request.actingSubject,
            },
          },
          body: { personId: request.personId, recipient: request.recipient },
        }),
      {
        status: 200,
        schema: versionDocumentSchema,
        otherwise: { 404: none, ...refusedWith('declarations', [400, 403]) },
      },
    );
    return document as VersionDocument | null;
  }

  async personVersions(tenant: string, personId: string): Promise<PersonVersion[]> {
    const versions = await this.declarations.call(
      (api) =>
        api.GET('/internal/v1/persons/{personId}/declaration-versions', {
          params: { path: { personId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      {
        status: 200,
        schema: personVersionsSchema,
        otherwise: refusedWith('declarations', [400, 403]),
      },
    );
    return versions as PersonVersion[];
  }
}
