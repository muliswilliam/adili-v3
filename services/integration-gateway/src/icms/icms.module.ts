import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { ICMS_CLIENT_OPTIONS, IcmsClient, type IcmsClientOptions } from './icms-client.js';
import { IcmsController } from './icms.controller.js';
import { IcmsReferrals } from './icms-referrals.js';

/** ICMS referrals (`/internal/v1/icms/referrals`), on the adapter kit (spec 09). */
@Module({
  controllers: [IcmsController],
  providers: [
    IcmsReferrals,
    IcmsClient,
    {
      provide: ICMS_CLIENT_OPTIONS,
      useValue: { baseUrl: config.ICMS_BASE_URL } satisfies IcmsClientOptions,
    },
  ],
})
export class IcmsModule {}
