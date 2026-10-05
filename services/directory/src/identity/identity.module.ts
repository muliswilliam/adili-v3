import { Global, Module } from '@nestjs/common';
import { oidcRealmUrl } from '@adili/api-kit';

import { config } from '../config.js';
import { IdentityProvisioning } from './identity-provisioning.js';
import { KeycloakIdentityProvisioning } from './keycloak-identity-provisioning.js';

/**
 * Provides IdentityProvisioning backed by Keycloak. API tests swap in
 * InMemoryIdentityProvisioning with `overrideProvider(IdentityProvisioning)`.
 */
@Global()
@Module({
  providers: [
    {
      provide: IdentityProvisioning,
      useFactory: () =>
        new KeycloakIdentityProvisioning({
          issuerUrl: oidcRealmUrl(config),
          clientId: config.KEYCLOAK_CLIENT_ID,
          clientSecret: config.KEYCLOAK_CLIENT_SECRET,
          audience: config.OIDC_AUDIENCE,
        }),
    },
  ],
  exports: [IdentityProvisioning],
})
export class IdentityModule {}
