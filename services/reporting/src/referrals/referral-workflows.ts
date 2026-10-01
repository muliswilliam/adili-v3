import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { startOnce } from '../workflow-start.js';
import {
  type IcmsRegistrationInput,
  REFERRAL_ICMS_REGISTRATION_WORKFLOW,
  referralIcmsRegistrationWorkflowId,
} from './contract.js';
import type { referralIcmsRegistration } from './workflows.js';

/** Starts the referrals intake's workflow on Temporal (ADR-003). */
@Injectable()
export class ReferralWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  /**
   * ICMS accepted a push of the referral without a case number: starts the workflow that waits
   * for it (one per push). Already started (a retried push) is fine.
   */
  async awaitIcmsRegistration(input: IcmsRegistrationInput): Promise<void> {
    await startOnce<typeof referralIcmsRegistration>(
      this.temporal,
      REFERRAL_ICMS_REGISTRATION_WORKFLOW,
      referralIcmsRegistrationWorkflowId(input.referralId, input.attempt),
      [input],
    );
  }
}

/** `ReferralWorkflows` for the referrals module. */
@Module({ providers: [ReferralWorkflows], exports: [ReferralWorkflows] })
export class ReferralWorkflowsModule {}
