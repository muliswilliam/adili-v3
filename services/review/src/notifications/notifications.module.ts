import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';
import { MESSAGES_SCOPE } from '@adili/roles';

import { config } from '../config.js';
import { HttpNotificationsClient } from './http-notifications-client.js';
import { NotificationsClient } from './notifications-client.js';

/** The notifications messages API, called with the service's own token (ADR-013 §8.1). */
@Module({
  providers: [
    {
      provide: NotificationsClient,
      useFactory: () =>
        new HttpNotificationsClient({
          notificationsUrl: config.NOTIFICATIONS_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [MESSAGES_SCOPE],
          }),
        }),
    },
  ],
  exports: [NotificationsClient],
})
export class NotificationsModule {}
