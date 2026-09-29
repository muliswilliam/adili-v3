import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';

import { config } from './config.js';
import { DeclarationsClient } from './declarations/declarations-client.js';
import {
  DECLARATIONS_INTERNAL_SCOPE,
  HttpDeclarationsClient,
} from './declarations/http-declarations-client.js';
import { DirectoryClient } from './directory/directory-client.js';
import { DocumentsClient } from './documents/documents-client.js';
import {
  DOCUMENTS_INTERNAL_SCOPE,
  HttpDocumentsClient,
} from './documents/http-documents-client.js';
import {
  DIRECTORY_INTERNAL_SCOPE,
  HttpDirectoryClient,
} from './directory/http-directory-client.js';
import {
  HttpNotificationsClient,
  MESSAGES_SCOPE,
} from './notifications/http-notifications-client.js';
import { NotificationsClient } from './notifications/notifications-client.js';
import { HttpReviewClient, REVIEW_INTERNAL_SCOPE } from './review/http-review-client.js';
import { ReviewClient } from './review/review-client.js';

/** Client credentials of the reporting service's own account, for one callee's scope. */
const tokens = (scope: string) =>
  new ServiceTokenClient({
    issuerUrl: config.OIDC_ISSUER_URL,
    clientId: config.KEYCLOAK_CLIENT_ID,
    clientSecret: config.KEYCLOAK_CLIENT_SECRET,
    scopes: [scope],
  });

/**
 * The other services' internal APIs Form M reads from, called with the reporting service's own
 * token (ADR-013 §8.1): officer details (declarations), clarification details (review), the
 * Commission and its staff (directory), emails (notifications), and the submitted report's PDF
 * and receipt (documents).
 */
@Module({
  providers: [
    {
      provide: DeclarationsClient,
      useFactory: () =>
        new HttpDeclarationsClient({
          declarationsUrl: config.DECLARATIONS_URL,
          tokens: tokens(DECLARATIONS_INTERNAL_SCOPE),
        }),
    },
    {
      provide: ReviewClient,
      useFactory: () =>
        new HttpReviewClient({
          reviewUrl: config.REVIEW_URL,
          tokens: tokens(REVIEW_INTERNAL_SCOPE),
        }),
    },
    {
      provide: DirectoryClient,
      useFactory: () =>
        new HttpDirectoryClient({
          directoryUrl: config.DIRECTORY_URL,
          tokens: tokens(DIRECTORY_INTERNAL_SCOPE),
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
    {
      provide: DocumentsClient,
      useFactory: () =>
        new HttpDocumentsClient({
          documentsUrl: config.DOCUMENTS_URL,
          tokens: tokens(DOCUMENTS_INTERNAL_SCOPE),
        }),
    },
  ],
  exports: [
    DeclarationsClient,
    ReviewClient,
    DirectoryClient,
    NotificationsClient,
    DocumentsClient,
  ],
})
export class UpstreamModule {}
