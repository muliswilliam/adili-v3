import { Module } from '@nestjs/common';

import { ClockModule } from '../../clock.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';
import { ObligationWorkflows } from '../workflows.js';
import { ObligationSteps } from './obligation-steps.js';
import { ObligationsSweep } from './sweep.js';
import { TemporalObligationWorkflows } from './temporal-obligation-workflows.js';

/**
 * Obligation workflows (ADR-003): starting and signalling them after a commit, the steps their
 * activities take, and the reconciliation sweep.
 */
@Module({
  imports: [ClockModule, NotificationsModule],
  providers: [
    ObligationSteps,
    ObligationsSweep,
    { provide: ObligationWorkflows, useClass: TemporalObligationWorkflows },
  ],
  exports: [ObligationSteps, ObligationsSweep, ObligationWorkflows],
})
export class ObligationWorkflowsModule {}
