import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { UpstreamModule } from '../upstream.module.js';
import { CertifiedCopiesController } from './certified-copies.controller.js';
import { CertifiedCopiesService } from './certified-copies.service.js';
import { CertifiedCopyIssuanceModule } from './certified-copy-issuance.js';

/**
 * A declarant's access to their own declarations (spec 10, Administrative Mechanism 32): the
 * certified copies they ask for in the portal. Officer-recorded written applications (#303) order
 * copies through the same `CertifiedCopyIssuance`.
 */
@Module({
  imports: [ClockModule, UpstreamModule, CertifiedCopyIssuanceModule],
  controllers: [CertifiedCopiesController],
  providers: [CertifiedCopiesService],
})
export class SelfAccessModule {}
