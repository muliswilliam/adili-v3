import type { Provider } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';

import { config } from '../../config.js';
import { HttpIprsLookup, IPRS_SCOPE } from './http-iprs-lookup.js';
import { IprsLookup } from './iprs-lookup.js';

/** IPRS through the integration-gateway; API tests override `IprsLookup` with the in-memory one. */
export const iprsLookupProvider: Provider = {
  provide: IprsLookup,
  useFactory: () =>
    new HttpIprsLookup({
      integrationGatewayUrl: config.INTEGRATION_GATEWAY_URL,
      tokens: new ServiceTokenClient({
        issuerUrl: config.OIDC_ISSUER_URL,
        clientId: config.KEYCLOAK_CLIENT_ID,
        clientSecret: config.KEYCLOAK_CLIENT_SECRET,
        scopes: [IPRS_SCOPE],
      }),
    }),
};
