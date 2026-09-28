import { Bff, createOpenIdProvider, ValkeySessionStore } from '@adili/bff-auth';
import { getRequest } from '@tanstack/react-start/server';

import { env } from './env.server';
import type { Unauthenticated } from './results';

let bff: Bff | undefined;

export function getBff(): Bff {
  if (!bff) {
    const config = env();
    bff = new Bff({
      appUrl: config.APP_URL,
      cookieName: 'adili_portal',
      provider: createOpenIdProvider({
        issuerUrl: config.OIDC_ISSUER_URL,
        clientId: config.OIDC_CLIENT_ID,
        clientSecret: config.OIDC_CLIENT_SECRET,
        allowHttp: config.NODE_ENV !== 'production',
      }),
      store: new ValkeySessionStore(config.VALKEY_URL, 'portal:'),
    });
  }
  return bff;
}

/**
 * Runs `call` with a service client for the signed-in declarant, built from their access token
 * (which stays on the server), or says the session has ended.
 */
export async function asDeclarant<Client, T>(
  client: (accessToken: string) => Client,
  call: (client: Client) => Promise<T>,
): Promise<T | Unauthenticated> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { status: 'unauthenticated' };
  return call(client(session.accessToken));
}
