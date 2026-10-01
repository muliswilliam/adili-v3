import type { Provider } from '@nestjs/common';

import { config } from '../../config.js';
import { directoryServiceTokens } from '../../service-tokens.js';
import { HttpIprsLookup, IPRS_SCOPE } from './http-iprs-lookup.js';
import { IprsLookup } from './iprs-lookup.js';

/** IPRS through the integration-gateway; API tests override `IprsLookup` with the in-memory one. */
export const iprsLookupProvider: Provider = {
  provide: IprsLookup,
  useFactory: () =>
    new HttpIprsLookup({
      integrationGatewayUrl: config.INTEGRATION_GATEWAY_URL,
      tokens: directoryServiceTokens(IPRS_SCOPE),
    }),
};
