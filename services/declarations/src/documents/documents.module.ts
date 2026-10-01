import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';

import { config } from '../config.js';
import { DocumentsClient } from './documents-client.js';
import { DOCUMENTS_INTERNAL_SCOPE, HttpDocumentsClient } from './http-documents-client.js';

/** The documents internal uploads API, called with the service's own token (ADR-013 §8.1). */
@Module({
  providers: [
    {
      provide: DocumentsClient,
      useFactory: () =>
        new HttpDocumentsClient({
          documentsUrl: config.DOCUMENTS_API_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [DOCUMENTS_INTERNAL_SCOPE],
          }),
        }),
    },
  ],
  exports: [DocumentsClient],
})
export class DocumentsModule {}
