import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';

import type { CycleOpened, CycleOpeningPage, CycleOpeningPageRequest } from './contract.js';
import { CycleOpening } from './cycle-opening.js';

/**
 * The activities of `CycleOpeningWorkflow`, hosted by the declarations worker. Every public method
 * is an activity named after it (keep helpers out of this class); each is safe to retry.
 */
@Injectable()
export class CycleOpeningActivities {
  constructor(private readonly opening: CycleOpening) {}

  /** The cycles opened by today that were not opened for the tenant yet, oldest first. */
  cyclesToOpen(tenant: string): Promise<number[]> {
    return this.opening.cyclesToOpen(tenant);
  }

  /** Creates the cycle's biennials for one page (1,000) of the tenant's active officers. */
  openCyclePage(request: CycleOpeningPageRequest): Promise<CycleOpeningPage> {
    const context = Context.current();
    return this.opening.openPage(request, () => {
      context.heartbeat();
    });
  }

  /** Records the cycle opened for the tenant and announces it (`obligation.cycle-opened.v1`). */
  recordCycleOpened(tenant: string, cycle: CycleOpened): Promise<void> {
    return this.opening.recordOpened(tenant, cycle);
  }
}
