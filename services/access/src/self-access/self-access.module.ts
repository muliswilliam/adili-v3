import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { UpstreamModule } from '../upstream.module.js';
import { SelfAccessApplicationsController } from './applications.controller.js';
import { SelfAccessApplicationsService } from './applications.service.js';
import { CertifiedCopiesController } from './certified-copies.controller.js';
import { CertifiedCopiesService } from './certified-copies.service.js';
import { CertifiedCopyIssuanceModule } from './certified-copy-issuance.js';

/**
 * A declarant's access to their own declarations (spec 10, Administrative Mechanism 32): the
 * certified copies they ask for in the portal, and the written applications the access officer
 * records for them (in person, or through a representative), which order copies through the
 * same `CertifiedCopyIssuance`.
 */
@Module({
  imports: [ClockModule, CipherModule, UpstreamModule, CertifiedCopyIssuanceModule],
  controllers: [CertifiedCopiesController, SelfAccessApplicationsController],
  providers: [CertifiedCopiesService, SelfAccessApplicationsService],
})
export class SelfAccessModule {}
