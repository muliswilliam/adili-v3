import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';

import type { ObligationStatus } from '../engine.js';
import {
  type LoadedObligation,
  REMINDER_ATTEMPTS,
  type ReminderRequest,
  type SendReminderResult,
  type SweepResult,
} from './contract.js';
import { type ChannelProgress, ObligationSteps } from './obligation-steps.js';
import { ObligationsSweep } from './sweep.js';

/**
 * The activities of the obligation workflows, hosted by the declarations worker. Every public
 * method is an activity named after it (keep helpers out of this class); each is safe to retry.
 */
@Injectable()
export class ObligationActivities {
  constructor(
    private readonly steps: ObligationSteps,
    private readonly sweep: ObligationsSweep,
  ) {}

  /** The obligation's dates, status, reminder offsets and recorded reminders; null if unknown. */
  loadObligation(obligationId: string): Promise<LoadedObligation | null> {
    return this.steps.load(obligationId);
  }

  /** Moves an open obligation to `status`; returns the status it has afterwards. */
  setStatus(obligationId: string, status: ObligationStatus): Promise<ObligationStatus> {
    return this.steps.setStatus(obligationId, status);
  }

  /** Records reminders whose day passed before they could be sent. */
  recordSkippedReminders(
    obligationId: string,
    reminders: { offsetDays: number; scheduledAt: string }[],
  ): Promise<void> {
    return this.steps.recordSkipped(obligationId, reminders);
  }

  /**
   * Sends one reminder on both channels and records it. Channels sent by an earlier attempt are
   * kept in the heartbeat details and not sent again; the last attempt records the outcome.
   */
  sendReminder(request: ReminderRequest): Promise<SendReminderResult> {
    const context = Context.current();
    const progress = (context.info.heartbeatDetails ?? {}) as ChannelProgress;
    return this.steps.sendReminder(request, {
      last: context.info.attempt >= REMINDER_ATTEMPTS,
      progress,
      save: (saved) => {
        context.heartbeat(saved);
      },
    });
  }

  /** The hourly sweep: starts the workflows missing, cancels what exits no longer owe. */
  sweepObligations(): Promise<SweepResult> {
    const context = Context.current();
    return this.sweep.run({
      progress: (done) => {
        context.heartbeat(done);
      },
    });
  }
}
