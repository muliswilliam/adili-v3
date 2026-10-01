import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import {
  AcknowledgementController,
  InternalAcknowledgementController,
} from './acknowledgement.controller.js';
import { AcknowledgementConsumer } from './acknowledgement.consumer.js';
import { AcknowledgementService } from './acknowledgement.service.js';

/**
 * The acknowledgement slip of a submitted version (spec 06): the payload the documents service
 * pulls to issue it, the issued slip set on the version with the declarant notified, the
 * verified count, and the declarant's view and reissue.
 */
@Module({
  imports: [ClockModule, NotificationsModule],
  controllers: [
    AcknowledgementController,
    InternalAcknowledgementController,
    AcknowledgementConsumer,
  ],
  providers: [AcknowledgementService],
})
export class AcknowledgementModule {}
