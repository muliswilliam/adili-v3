import { Module } from '@nestjs/common';

import { ClockModule } from '../../clock.js';
import { DirectoryModule } from '../../directory/directory.module.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';
import { ObligationWorkflows } from '../workflows.js';
import { CycleOpening } from './cycle-opening.js';
import { ObligationSteps } from './obligation-steps.js';
import { ObligationsSweep } from './sweep.js';
import { TemporalObligationWorkflows } from './temporal-obligation-workflows.js';

/**
 * Obligation workflows (ADR-003): starting and signalling them after a commit, the steps their
 * activities take, the reconciliation sweep and the cycle opening.
 */
@Module({
  imports: [ClockModule, DirectoryModule, NotificationsModule],
  providers: [
    CycleOpening,
    ObligationSteps,
    ObligationsSweep,
    { provide: ObligationWorkflows, useClass: TemporalObligationWorkflows },
  ],
  exports: [CycleOpening, ObligationSteps, ObligationsSweep, ObligationWorkflows],
})
export class ObligationWorkflowsModule {}
