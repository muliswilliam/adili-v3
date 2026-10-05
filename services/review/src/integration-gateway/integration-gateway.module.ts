import { Module } from '@nestjs/common';
import { oidcRealmUrl, ServiceTokenClient } from '@adili/api-kit';
import { PAYROLL_SCOPE, REGISTRY_SCOPE } from '@adili/roles';

import { config } from '../config.js';
import { HttpIntegrationGatewayClient } from './http-integration-gateway-client.js';
import { IntegrationGatewayClient } from './integration-gateway-client.js';

/**
 * The integration-gateway's internal API, called with the service's own token (ADR-013 §8.1):
 * payroll instructions (`payroll`) and registry lookups with their stored results (`registry`).
 */
@Module({
  providers: [
    {
      provide: IntegrationGatewayClient,
      useFactory: () =>
        new HttpIntegrationGatewayClient({
          gatewayUrl: config.INTEGRATION_GATEWAY_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: oidcRealmUrl(config),
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [PAYROLL_SCOPE, REGISTRY_SCOPE],
          }),
        }),
    },
  ],
  exports: [IntegrationGatewayClient],
})
export class IntegrationGatewayModule {}
