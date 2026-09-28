import type { ServiceTokenClient } from '@adili/api-kit';
import createClient, { type Client } from 'openapi-fetch';
import { z } from 'zod';

import type { paths } from './directory-api.gen.js';
import {
  ContactLookupError,
  type PersonContacts,
  PersonContactsSource,
} from './person-contacts.js';

/** The scope the notifications service token needs for the directory's internal API. */
export const DIRECTORY_INTERNAL_SCOPE = 'directory:internal';

export interface DirectoryPersonContactsOptions {
  /** Base URL of the directory service, e.g. `http://localhost:4001`. */
  directoryUrl: string;
  /** Client credentials tokens of the notifications client carrying `directory:internal`. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** The whole lookup, token included. */
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
 * packages/schemas/internal/directory.yaml via `pnpm generate:api`) with the service's own token.
 * An unknown person (404) has no contacts; every other failure is a `ContactLookupError`.
 */
export class DirectoryPersonContacts extends PersonContactsSource {
  private readonly directory: Client<paths>;

  constructor(private readonly options: DirectoryPersonContactsOptions) {
    super();
    const fetchImpl = options.fetch ?? globalThis.fetch;
    this.directory = createClient<paths>({
      baseUrl: options.directoryUrl.replace(/\/$/, ''),
      headers: { accept: 'application/json' },
      fetch: (request) => fetchImpl(request),
    });
  }

  async lookup(personId: string): Promise<PersonContacts> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new ContactLookupError(
          `directory did not answer within ${String(this.options.timeoutMs)}ms`,
        );
        controller.abort(error);
        reject(error);
      }, this.options.timeoutMs);
    });
    try {
      return await Promise.race([this.read(personId, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async read(personId: string, signal: AbortSignal): Promise<PersonContacts> {
    let answer = await this.get(personId, signal);
    if (answer.response.status === 401) {
      this.options.tokens.invalidate();
      answer = await this.get(personId, signal);
    }
    const { data, response } = answer;
    if (response.status === 404) {
      return { email: null, phone: null };
    }
    if (response.status !== 200) {
      throw new ContactLookupError(`directory answered ${String(response.status)}`);
    }
    const parsed = contactsBody.safeParse(data);
    if (!parsed.success) {
      throw new ContactLookupError('directory answered without contacts');
    }
    return parsed.data;
  }

  private async get(personId: string, signal: AbortSignal) {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      throw new ContactLookupError('no service token for the directory', { cause: error });
    }
    try {
      return await this.directory.GET('/internal/v1/persons/{personId}/contacts', {
        params: { path: { personId } },
        headers: { authorization: `Bearer ${token}` },
        signal,
      });
    } catch (error) {
      if (error instanceof ContactLookupError) throw error;
      throw new ContactLookupError('the directory is unreachable', { cause: error });
    }
  }
}
