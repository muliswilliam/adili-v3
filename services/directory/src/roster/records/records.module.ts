import { Module } from '@nestjs/common';
import { MESSAGES_SCOPE } from '@adili/roles';

import { Clock, SystemClock } from '../../clock.js';
import { config } from '../../config.js';
import { directoryServiceTokens } from '../../service-tokens.js';

import {
  InternalRosterNationalIdController,
  InternalRosterRecordsController,
} from './internal-records.controller.js';
import { InternalRosterRecordsService } from './internal-records.service.js';
import { InvitationDelivery, NotificationsInvitationDelivery } from './invitation-delivery.js';
import { OnboardingInvitationsService } from './onboarding-invitations.service.js';
import { RosterRecordsController } from './records.controller.js';
import { RosterRecordsService } from './records.service.js';

/**
 * Reading a Commission's roster (spec #27): records, one record, and the summary; and the pulls
 * of services after roster events (spec 04), with a record's national ID on its own (spec 08);
 * and invitations to onboard sent to a record's roster contacts for the access service (spec 10).
 */
@Module({
  controllers: [
    RosterRecordsController,
    InternalRosterRecordsController,
    InternalRosterNationalIdController,
  ],
  providers: [
    RosterRecordsService,
    InternalRosterRecordsService,
    OnboardingInvitationsService,
    { provide: Clock, useClass: SystemClock },
    {
      provide: InvitationDelivery,
      useFactory: () =>
        new NotificationsInvitationDelivery({
          notificationsUrl: config.NOTIFICATIONS_URL,
          tokens: directoryServiceTokens(MESSAGES_SCOPE),
        }),
    },
  ],
})
export class RosterRecordsModule {}
