import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';

import { config } from '../../config.js';
import { DOCUMENTS_INTERNAL_SCOPE, HttpRosterUploads } from './http-roster-uploads.js';
import { RosterUploads } from './roster-uploads.js';

/** Roster uploads read through the documents service's internal API (decision 2). */
@Module({
  providers: [
    {
      provide: RosterUploads,
      useFactory: () =>
        new HttpRosterUploads({
          documentsUrl: config.DOCUMENTS_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [DOCUMENTS_INTERNAL_SCOPE],
          }),
        }),
    },
  ],
  exports: [RosterUploads],
})
export class RosterUploadsModule {}
