import { Module } from '@nestjs/common';
import { DOCUMENTS_INTERNAL_SCOPE } from '@adili/roles';

import { config } from '../../config.js';
import { directoryServiceTokens } from '../../service-tokens.js';
import { HttpRosterUploads } from './http-roster-uploads.js';
import { RosterUploads } from './roster-uploads.js';

/** Roster uploads read through the documents service's internal API (decision 2). */
@Module({
  providers: [
    {
      provide: RosterUploads,
      useFactory: () =>
        new HttpRosterUploads({
          documentsUrl: config.DOCUMENTS_URL,
          tokens: directoryServiceTokens(DOCUMENTS_INTERNAL_SCOPE),
        }),
    },
  ],
  exports: [RosterUploads],
})
export class RosterUploadsModule {}
