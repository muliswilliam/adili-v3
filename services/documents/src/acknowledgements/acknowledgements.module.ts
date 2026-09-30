import { Module } from '@nestjs/common';

import { DeclarationsModule } from '../declarations/declarations.module.js';
import { IssuanceModule } from '../issuance/issuance.module.js';
import { AcknowledgementConsumer } from './acknowledgement.consumer.js';
import { AcknowledgementIssuer } from './acknowledgement-issuer.js';

/** Acknowledgement slips of submitted declaration versions, issued on declarations' events. */
@Module({
  imports: [DeclarationsModule, IssuanceModule],
  controllers: [AcknowledgementConsumer],
  providers: [AcknowledgementIssuer],
})
export class AcknowledgementsModule {}
