import { Bff, createOpenIdProvider, ValkeySessionStore } from '@adili/bff-auth';
import { demoStepUpParams } from '@adili/demo-auth';
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
      ...(config.DEMO_MODE && config.DEMO_TICKET_SECRET
        ? demoOptions(config.DEMO_TICKET_SECRET)
        : {}),
    });
  }
  return bff;
}

/**
 * Demo mode (#616): a demo account's step-up passes with a ticket instead of a code, and the
 * session is rechecked with Keycloak every few seconds, so a role switch in the other app (which
 * ends the browser's Keycloak session) signs this one out at once instead of after the token's
 * five minutes.
 */
function demoOptions(ticketSecret: string) {
  return {
    authorizeParams: (request: Request, kind: 'login' | 'step-up') =>
      demoStepUpParams(getBff(), request, kind, ticketSecret),
    revalidateAfterMs: 3000,
  };
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
