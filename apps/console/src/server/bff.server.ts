import { Bff, createOpenIdProvider, ValkeySessionStore } from '@adili/bff-auth';

import { env } from './env.server';

let bff: Bff | undefined;

export function getBff(): Bff {
  if (!bff) {
    const config = env();
    bff = new Bff({
      appUrl: config.APP_URL,
      cookieName: 'adili_console',
      provider: createOpenIdProvider({
        issuerUrl: config.OIDC_ISSUER_URL,
        clientId: config.OIDC_CLIENT_ID,
        clientSecret: config.OIDC_CLIENT_SECRET,
        allowHttp: config.NODE_ENV !== 'production',
      }),
      store: new ValkeySessionStore(config.VALKEY_URL, 'console:'),
    });
  }
  return bff;
}
