import { Module } from '@nestjs/common';
import { oidcRealmUrl, ServiceTokenClient } from '@adili/api-kit';
import { DOCUMENTS_INTERNAL_SCOPE } from '@adili/roles';

import { config } from '../config.js';
import { DocumentsClient } from './documents-client.js';
import { HttpDocumentsClient } from './http-documents-client.js';

/** The documents internal API, called with the service's own token (ADR-013 §8.1). */
@Module({
  providers: [
    {
      provide: DocumentsClient,
      useFactory: () =>
        new HttpDocumentsClient({
          documentsUrl: config.DOCUMENTS_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: oidcRealmUrl(config),
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
