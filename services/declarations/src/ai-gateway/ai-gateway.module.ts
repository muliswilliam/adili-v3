import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';

import { config } from '../config.js';
import { AiGatewayClient } from './ai-gateway-client.js';
import { AI_SCOPE, HttpAiGatewayClient } from './http-ai-gateway-client.js';

/** The ai-gateway's internal API, called with the service's own token (ADR-013 §8.1). */
@Module({
  providers: [
    {
      provide: AiGatewayClient,
      useFactory: () =>
        new HttpAiGatewayClient({
          gatewayUrl: config.AI_GATEWAY_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [AI_SCOPE],
          }),
        }),
    },
  ],
  exports: [AiGatewayClient],
})
export class AiGatewayModule {}
