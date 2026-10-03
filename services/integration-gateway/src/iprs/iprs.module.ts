import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { IPRS_CLIENT_OPTIONS, IprsClient, type IprsClientOptions } from './iprs-client.js';
import { IprsController } from './iprs.controller.js';

/** IPRS identity lookup for onboarding (`/internal/v1/iprs`), on the adapter kit. */
@Module({
  controllers: [IprsController],
  providers: [
    IprsClient,
    {
      provide: IPRS_CLIENT_OPTIONS,
      useValue: { baseUrl: config.IPRS_BASE_URL } satisfies IprsClientOptions,
    },
  ],
})
export class IprsModule {}
