import { Module } from '@nestjs/common';
import { FieldCipher, OpenBaoTransitCipher } from '@adili/data-access';

import { config } from './config.js';

/** OpenBao Transit connection of the service (ADR-006 tenant keys). */
export const OPENBAO = { url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN };

/**
 * The `FieldCipher` that encrypts the copilot's outputs under the Commission's key: they hold
 * declaration content, which the review service otherwise never stores. For the HTTP modules and
 * the worker's activities alike.
 */
@Module({
  providers: [{ provide: FieldCipher, useFactory: () => new OpenBaoTransitCipher(OPENBAO) }],
  exports: [FieldCipher],
})
export class CipherModule {}
