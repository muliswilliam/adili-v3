import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { DeterminationsModule } from '../determinations/determinations.module.js';
import { EnforcementModule } from '../enforcement/enforcement.module.js';
import { ReferralsModule } from '../referrals/referrals.module.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';

/**
 * The approvals inbox and reassignment (spec 08): the union of the approval sources of
 * determinations, of the ladder's actions and of referrals.
 */
@Module({
  imports: [ClockModule, DeterminationsModule, EnforcementModule, ReferralsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
