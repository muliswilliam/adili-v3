import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';
import {
  DECLARATIONS_INTERNAL_SCOPE,
  DIRECTORY_INTERNAL_SCOPE,
  DOCUMENTS_INTERNAL_SCOPE,
  MESSAGES_SCOPE,
} from '@adili/roles';

import { config } from './config.js';
import { DeclarationsClient } from './declarations/declarations-client.js';
import { HttpDeclarationsClient } from './declarations/http-declarations-client.js';
import { DirectoryClient } from './directory/directory-client.js';
import { HttpDirectoryClient } from './directory/http-directory-client.js';
import { DocumentsClient } from './documents/documents-client.js';
import { HttpDocumentsClient } from './documents/http-documents-client.js';
import { HttpNotificationsClient } from './notifications/http-notifications-client.js';
import { NotificationsClient } from './notifications/notifications-client.js';

/** Client credentials of the access service's own account, for one callee's scope. */
const tokens = (scope: string) =>
  new ServiceTokenClient({
    issuerUrl: config.OIDC_ISSUER_URL,
    clientId: config.KEYCLOAK_CLIENT_ID,
    clientSecret: config.KEYCLOAK_CLIENT_SECRET,
    scopes: [scope],
  });

/**
 * The other services' internal APIs the access service calls, with its own token through clients
 * generated from their contracts (ADR-013 §2, §8.7): Commissions, roster records and staff
 * (directory), scoped disclosures and full documents (declarations), packages, certified copies
 * and representation attachments (documents), and messages (notifications).
 */
@Module({
  providers: [
    {
      provide: DirectoryClient,
      useFactory: () =>
        new HttpDirectoryClient({
          directoryUrl: config.DIRECTORY_URL,
          tokens: tokens(DIRECTORY_INTERNAL_SCOPE),
        }),
    },
    {
      provide: DeclarationsClient,
      useFactory: () =>
        new HttpDeclarationsClient({
          declarationsUrl: config.DECLARATIONS_URL,
          tokens: tokens(DECLARATIONS_INTERNAL_SCOPE),
        }),
    },
    {
      provide: DocumentsClient,
      useFactory: () =>
        new HttpDocumentsClient({
          documentsUrl: config.DOCUMENTS_URL,
          tokens: tokens(DOCUMENTS_INTERNAL_SCOPE),
        }),
    },
    {
      provide: NotificationsClient,
      useFactory: () =>
        new HttpNotificationsClient({
          notificationsUrl: config.NOTIFICATIONS_URL,
          tokens: tokens(MESSAGES_SCOPE),
        }),
    },
  ],
  exports: [DirectoryClient, DeclarationsClient, DocumentsClient, NotificationsClient],
})
export class UpstreamModule {}
