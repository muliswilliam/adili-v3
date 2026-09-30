import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  type ContactLookup,
  ContactLookupError,
  type PersonContacts,
  PersonContactsSource,
} from './person-contacts.js';

export interface DirectoryPersonContactsOptions {
  /** Base URL of the directory service, e.g. `http://localhost:4001`. */
  directoryUrl: string;
  /** Client credentials tokens of the notifications client carrying `directory:person-contacts`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Per attempt. The whole send, lookup included, is bounded by the messages service. */
  timeoutMs: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const contactsBody = z.object({
  email: z.string().min(1).nullable(),
  phone: z.string().min(1).nullable(),
});

/**
 * Reads a person's verified contacts from the directory
 * (`GET /internal/v1/persons/{personId}/contacts`, client generated from
 * packages/schemas/internal/directory.yaml via `pnpm generate:api`) on api-kit's service client:
 * the service's own token, the message's tenant in `X-Acting-Tenant` (ADR-013 §8.1, ADR-016). A
 * person the directory does not know, or who is not onboarded at that tenant (404), has no
 * contacts; every other failure is a `ContactLookupError`.
 */
export class DirectoryPersonContacts extends PersonContactsSource {
  private readonly directory: ServiceClient<paths>;

  constructor(options: DirectoryPersonContactsOptions) {
    super();
    this.directory = createServiceClient<paths>({
      baseUrl: options.directoryUrl,
      service: 'directory',
      tokens: options.tokens,
      unavailable: (message, cause) => new ContactLookupError(message, cause),
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
  }

  lookup({ personId, tenant }: ContactLookup): Promise<PersonContacts> {
    return this.directory.call(
      (api) =>
        api.GET('/internal/v1/persons/{personId}/contacts', {
          params: { path: { personId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      {
        status: 200,
        schema: contactsBody,
        otherwise: { 404: () => ({ email: null, phone: null }) },
      },
    );
  }
}
