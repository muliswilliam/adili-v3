import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';
import { DIRECTORY_INTERNAL_SCOPE } from '@adili/roles';

import { config } from '../config.js';
import { DirectoryClient } from './directory-client.js';
import { HttpDirectoryClient } from './http-directory-client.js';

/** The directory's internal API, called with the service's own token (ADR-013 §8.1, ADR-017). */
@Module({
  providers: [
    {
      provide: DirectoryClient,
      useFactory: () =>
        new HttpDirectoryClient({
          directoryUrl: config.DIRECTORY_API_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [DIRECTORY_INTERNAL_SCOPE],
          }),
        }),
    },
  ],
  exports: [DirectoryClient],
})
export class DirectoryModule {}
