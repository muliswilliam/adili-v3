import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { Clock } from '../../clock.js';
import { config } from '../../config.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import {
  NotificationsClient,
  NotificationsRejected,
  NotificationsUnavailable,
  type ReminderChannel,
} from '../../notifications/notifications-client.js';
import type { Transaction } from '../apply-page.js';
import { type CivilDate, nairobiDate } from '../dates.js';
import type { ObligationStatus } from '../engine.js';
import { obligationReminderSent, obligationStatusChanged } from '../events.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import {
  commissionRefs,
  filingObligations,
  obligationReminders,
  type ReminderOutcome,
} from '../schema.js';
import type { LoadedObligation, ReminderRequest, SendReminderResult } from './contract.js';

/** Platform work: every tenant's rows (the workflow knows the obligation, not its tenant). */
const PLATFORM = { tenant: 'platform', subject: SYSTEM_SUBJECT } as const;
const CHANNELS: readonly ReminderChannel[] = ['sms', 'email'];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The template limits (notifications contract). */
const COMMISSION_NAME_MAX = 120;
const DAYS_LEFT_MAX = 366;

/** What each channel of a reminder came to so far, kept across attempts (activity heartbeats). */
export type ChannelProgress = Partial<
  Record<
    ReminderChannel,
    | { status: 'sent'; messageId: string }
    | { status: 'no-contact' }
    | { status: 'failed'; error: string }
  >
>;

/** The attempt of `sendReminder` running, as Temporal reports it. */
export interface ReminderAttempt {
  /** The last attempt records an outcome whatever happens, instead of asking for a retry. */
  last: boolean;
  /** What earlier attempts achieved, so a retry never sends a channel twice. */
  progress: ChannelProgress;
  /** Saves progress for the next attempt. */
  save(progress: ChannelProgress): void;
}

/** A send that failed in a way worth retrying (notifications or its provider unreachable). */
export class ReminderRetryable extends Error {
  override readonly name = 'ReminderRetryable';
}

/** Notifications' reasons that name a lasting fact about the recipient: no retry. */
const FINAL_REASONS = new Set(['no-contact', 'rejected-recipient']);

/**
 * What the obligation workflows do to the database and the outside world (the activities
 * delegate here): read an obligation, move its status on, send or skip its reminders. Every
 * method is safe to repeat: status changes are conditional and reminder rows unique per offset.
 */
@Injectable()
export class ObligationSteps {
  private readonly logger = new Logger(ObligationSteps.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    @Inject(EventPublisher) private readonly events: EventPublisher,
    private readonly notifications: NotificationsClient,
    private readonly clock: Clock,
  ) {}

  async load(obligationId: string): Promise<LoadedObligation | null> {
    return withTenant(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .select({
          tenant: filingObligations.tenant,
          type: filingObligations.type,
          statementDate: filingObligations.statementDate,
          dueDate: filingObligations.dueDate,
          status: filingObligations.status,
          personId: filingObligations.personId,
          reminderOffsetsDays: filingObligations.reminderOffsetsDays,
        })
        .from(filingObligations)
        .where(eq(filingObligations.id, obligationId));
      if (!row) return null;
      const recorded = await tx
        .select({ offsetDays: obligationReminders.offsetDays })
        .from(obligationReminders)
        .where(eq(obligationReminders.obligationId, obligationId));
      return {
        obligationId,
        tenant: row.tenant,
        type: row.type,
        statementDate: row.statementDate,
        dueDate: row.dueDate,
        status: row.status,
        personLinked: row.personId !== null,
        // The offsets of the policy version the obligation was created under (ADR-003 §4).
        reminderOffsetsDays: row.reminderOffsetsDays,
        recordedOffsets: recorded.map((r) => r.offsetDays),
        jitterWindowMs: config.REMINDER_JITTER_HOURS * HOUR_MS,
      };
    });
  }

  /**
   * Moves an open obligation to `to` with an `obligation.status-changed.v1` event. A terminal
   * obligation (cancelled, filed) is left alone. Returns the status it has afterwards.
   */
  async setStatus(obligationId: string, to: ObligationStatus): Promise<ObligationStatus> {
    return withTenant(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .select({ tenant: filingObligations.tenant, status: filingObligations.status })
        .from(filingObligations)
        .where(eq(filingObligations.id, obligationId))
        .for('update');
      if (!row) {
        this.logger.warn({ obligationId }, 'Obligation of a running workflow not found');
        return 'cancelled';
      }
      if (row.status === to || row.status === 'cancelled' || row.status === 'filed') {
        return row.status;
      }
      await tx
        .update(filingObligations)
        .set({ status: to })
        .where(eq(filingObligations.id, obligationId));
      await this.events.record(
        tx,
        obligationStatusChanged(row.tenant, { obligationId, from: row.status, to, reason: null }),
      );
      return to;
    });
  }

  /** Records reminders whose day passed before they could be sent: never sent. */
  async recordSkipped(
    obligationId: string,
    reminders: readonly { offsetDays: number; scheduledAt: string }[],
  ): Promise<void> {
    if (reminders.length === 0) return;
    await withTenant(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .select({ tenant: filingObligations.tenant })
        .from(filingObligations)
        .where(eq(filingObligations.id, obligationId));
      if (!row) return;
      const recorded = await tx
        .insert(obligationReminders)
        .values(
          reminders.map((reminder) => ({
            obligationId,
            tenant: row.tenant,
            offsetDays: reminder.offsetDays,
            scheduledAt: new Date(reminder.scheduledAt),
            outcome: 'skipped-past-due-at-creation' as const,
          })),
        )
        .onConflictDoNothing()
        .returning({
          offsetDays: obligationReminders.offsetDays,
          outcome: obligationReminders.outcome,
        });
      await this.events.recordAll(
        tx,
        recorded.map(({ offsetDays, outcome }) =>
          obligationReminderSent(row.tenant, { obligationId, offsetDays, channels: [], outcome }),
        ),
      );
    });
  }

  /**
   * Sends one reminder of an obligation (SMS and email, recipient the linked person) and records
   * its outcome with an `obligation.reminder-sent.v1` event:
   *
   * - no person linked (not onboarded): `skipped-not-onboarded`, nothing sent;
   * - notifications has no contact for either channel: `skipped-no-contact`;
   * - at least one channel sent: `sent`, with the channels and message ids;
   * - otherwise `failed`. A failure worth retrying (notifications, the directory or the provider
   *   unreachable) throws `ReminderRetryable` instead, except on the last attempt.
   *
   * An obligation no longer open for reminders (overdue, cancelled, filed) gets no row:
   * `not-open`. A reminder already recorded is not sent again.
   */
  async sendReminder(
    request: ReminderRequest,
    attempt: ReminderAttempt,
  ): Promise<SendReminderResult> {
    const { obligationId, offsetDays } = request;
    const recorded = await this.recordedOutcome(obligationId, offsetDays);
    if (recorded) return recorded;
    const obligation = await this.reminderContext(obligationId);
    if (!obligation || (obligation.status !== 'upcoming' && obligation.status !== 'due')) {
      return 'not-open';
    }
    const { personId } = obligation;
    if (personId === null) {
      return this.record(obligation.tenant, request, 'skipped-not-onboarded', {});
    }

    const progress: ChannelProgress = { ...attempt.progress };
    // Everything sent derives from the reminder, not the clock, so a retry sends the same request.
    const params = {
      type: obligation.type,
      commissionName: obligation.commissionName.slice(0, COMMISSION_NAME_MAX),
      statementDate: obligation.statementDate,
      dueDate: obligation.dueDate,
      daysLeft: daysLeft(nairobiDate(new Date(request.scheduledAt)), obligation.dueDate),
      portalUrl: config.PORTAL_URL,
    };
    const retryable: string[] = [];
    for (const channel of CHANNELS) {
      if (progress[channel]) continue;
      try {
        const outcome = await this.notifications.sendReminder({
          channel,
          personId,
          tenant: obligation.tenant,
          params,
          idempotencyKey: reminderMessageKey(request, channel),
        });
        if (outcome.status === 'sent') {
          progress[channel] = outcome;
        } else if (outcome.error === 'no-contact') {
          progress[channel] = { status: 'no-contact' };
        } else if (FINAL_REASONS.has(outcome.error)) {
          progress[channel] = { status: 'failed', error: outcome.error };
        } else {
          retryable.push(`${channel}: ${outcome.error}`);
        }
      } catch (error) {
        if (error instanceof NotificationsRejected) {
          this.logger.error(
            { err: error, obligationId, channel },
            'Reminder refused by notifications',
          );
          progress[channel] = { status: 'failed', error: 'rejected-request' };
        } else if (error instanceof NotificationsUnavailable) {
          retryable.push(`${channel}: ${error.message}`);
        } else {
          throw error;
        }
      }
      attempt.save(progress);
    }
    if (retryable.length > 0 && !attempt.last) {
      throw new ReminderRetryable(`Reminder not sent yet (${retryable.join('; ')})`);
    }

    const sent = CHANNELS.flatMap((channel) => {
      const done = progress[channel];
      return done?.status === 'sent' ? [{ channel, messageId: done.messageId }] : [];
    });
    if (sent.length > 0) {
      return this.record(obligation.tenant, request, 'sent', {
        channels: sent.map((s) => s.channel),
        messageIds: sent.map((s) => s.messageId),
        sentAt: this.clock.now(),
      });
    }
    const noContact = CHANNELS.every((channel) => progress[channel]?.status === 'no-contact');
    return this.record(obligation.tenant, request, noContact ? 'skipped-no-contact' : 'failed', {});
  }

  private async recordedOutcome(
    obligationId: string,
    offsetDays: number,
  ): Promise<ReminderOutcome | undefined> {
    const [row] = await withTenant(this.db, PLATFORM, (tx) =>
      tx
        .select({ outcome: obligationReminders.outcome })
        .from(obligationReminders)
        .where(
          and(
            eq(obligationReminders.obligationId, obligationId),
            eq(obligationReminders.offsetDays, offsetDays),
          ),
        ),
    );
    return row?.outcome;
  }

  private async reminderContext(obligationId: string) {
    const [row] = await withTenant(this.db, PLATFORM, (tx) =>
      tx
        .select({
          tenant: filingObligations.tenant,
          type: filingObligations.type,
          statementDate: filingObligations.statementDate,
          dueDate: filingObligations.dueDate,
          status: filingObligations.status,
          personId: filingObligations.personId,
          commissionName: commissionRefs.name,
        })
        .from(filingObligations)
        .leftJoin(commissionRefs, eq(commissionRefs.slug, filingObligations.tenant))
        .where(eq(filingObligations.id, obligationId)),
    );
    return row && { ...row, commissionName: row.commissionName ?? row.tenant.toUpperCase() };
  }

  /** Writes the reminder row and its event once; a row already there wins. */
  private async record(
    tenant: string,
    request: ReminderRequest,
    outcome: ReminderOutcome,
    sent: { channels?: ReminderChannel[]; messageIds?: string[]; sentAt?: Date },
  ): Promise<ReminderOutcome> {
    const { obligationId, offsetDays } = request;
    const channels = sent.channels ?? [];
    return withTenant(this.db, { tenant, subject: SYSTEM_SUBJECT }, async (tx: Transaction) => {
      const inserted = await tx
        .insert(obligationReminders)
        .values({
          obligationId,
          tenant,
          offsetDays,
          scheduledAt: new Date(request.scheduledAt),
          sentAt: sent.sentAt ?? null,
          channels,
          messageIds: sent.messageIds ?? [],
          outcome,
        })
        .onConflictDoNothing()
        .returning({ outcome: obligationReminders.outcome });
      if (inserted.length === 0) {
        const [existing] = await tx
          .select({ outcome: obligationReminders.outcome })
          .from(obligationReminders)
          .where(
            and(
              eq(obligationReminders.obligationId, obligationId),
              eq(obligationReminders.offsetDays, offsetDays),
            ),
          );
        return existing?.outcome ?? outcome;
      }
      await this.events.record(
        tx,
        obligationReminderSent(tenant, { obligationId, offsetDays, channels, outcome }),
      );
      return outcome;
    });
  }
}

/** Namespace of the reminder messages' idempotency keys (UUID v5). */
const REMINDER_KEY_NAMESPACE = '5b8f2c1e-3d4a-4e6f-9a7b-0c1d2e3f4a5b';

/** The `Idempotency-Key` of one channel of one reminder: a UUID derived from both. */
export function reminderMessageKey(request: ReminderRequest, channel: ReminderChannel): string {
  return uuidv5(
    `${request.obligationId}:${String(request.offsetDays)}:${channel}`,
    REMINDER_KEY_NAMESPACE,
  );
}

/** Whole days from `today` to the due date, within the template's 0 to 366. */
function daysLeft(today: CivilDate, dueDate: CivilDate): number {
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / DAY_MS);
  return Math.min(DAYS_LEFT_MAX, Math.max(0, days));
}
