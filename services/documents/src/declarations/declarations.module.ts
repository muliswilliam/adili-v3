import { Module } from '@nestjs/common';
import { oidcRealmUrl, ServiceTokenClient } from '@adili/api-kit';
import { DECLARATIONS_INTERNAL_SCOPE } from '@adili/roles';

import { config } from '../config.js';
import { DeclarationsClient } from './declarations-client.js';
import { HttpDeclarationsClient } from './http-declarations-client.js';

/** The declarations internal API, called with the service's own token (ADR-013 §8.1). */
@Module({
  providers: [
    {
      provide: DeclarationsClient,
      useFactory: () =>
        new HttpDeclarationsClient({
          declarationsUrl: config.DECLARATIONS_API_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: oidcRealmUrl(config),
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [DECLARATIONS_INTERNAL_SCOPE],
          }),
        }),
    },
  ],
  exports: [DeclarationsClient],
})
export class DeclarationsModule {}
