import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { IPRS_CLIENT_OPTIONS, IprsClient, type IprsClientOptions } from './iprs-client.js';
import { IprsController } from './iprs.controller.js';
import { IprsRecordsController } from './iprs-records.controller.js';

/**
 * IPRS on the adapter kit (`/internal/v1/iprs`): the identity lookup for onboarding, and the
 * recorded lookup a declarant asks for their own particulars.
 */
@Module({
  controllers: [IprsController, IprsRecordsController],
  providers: [
    IprsClient,
    {
      provide: IPRS_CLIENT_OPTIONS,
      useValue: { baseUrl: config.IPRS_BASE_URL } satisfies IprsClientOptions,
    },
  ],
})
export class IprsModule {}
