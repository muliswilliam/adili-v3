import { Module } from '@nestjs/common';
import { FieldCipher, OpenBaoTransitCipher } from '@adili/data-access';

import { config } from './config.js';

/**
 * The `FieldCipher` that seals what the gateway keeps of people's own words (reviewers' feedback
 * notes) under the tenant's key in OpenBao Transit (ADR-006).
 */
@Module({
  providers: [
    {
      provide: FieldCipher,
      useFactory: () =>
        new OpenBaoTransitCipher({ url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN }),
    },
  ],
  exports: [FieldCipher],
})
export class CipherModule {}
