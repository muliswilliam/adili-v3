import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { Clock } from '../../clock.js';
import { config, REMINDER_JITTER_WINDOW_MS } from '../../config.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import type { Transaction } from '../../db/transaction.js';
import {
  NotificationsClient,
  NotificationsKeyReused,
  NotificationsRejected,
  NotificationsUnavailable,
  type MessageChannel,
  type ReminderParams,
} from '../../notifications/notifications-client.js';
import { fallbackIssuerCode } from '../access.js';
import { addDays, type CivilDate, daysBetween, nairobiDate } from '../dates.js';
import { movesForward, type ObligationStatus, type OpenStatus } from '../engine.js';
import { obligationReminderRecorded, obligationStatusChanged } from '../events.js';
import { PLATFORM_CONTEXT, systemContext } from '../system-context.js';
import {
  commissionRefs,
  filingObligations,
  obligationReminders,
  type ReminderOutcome,
  reminderMessages,
} from '../schema.js';
import type {
  LoadedObligation,
  ObligationRef,
  ReminderRequest,
  SendReminderResult,
} from './contract.js';

const CHANNELS: readonly MessageChannel[] = ['sms', 'email'];
/** The template limits (notifications contract). */
const COMMISSION_NAME_MAX = 120;
const DAYS_LEFT_MAX = 366;

/** What each channel of a reminder came to so far, kept across attempts (activity heartbeats). */
export type ChannelProgress = Partial<
  Record<
    MessageChannel,
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

/**
 * Notifications' reasons that are final: a lasting fact about the recipient, or a provider
 * `timeout`, where the message may have gone out (notifications replays it under the key, so a
 * retry could not send it again anyway). No retry.
 */
const FINAL_REASONS = new Set(['no-contact', 'rejected-recipient', 'timeout']);

/**
 * What the obligation workflows do to the database and the outside world (the activities
 * delegate here): read an obligation, move its status on, send or skip its reminders. Every
 * method is safe to repeat: status changes are conditional and reminder rows unique per offset.
 * `load` finds the obligation across tenants (the workflow knows only its id); every other step
 * runs in the obligation's tenant's RLS context.
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
    return withTenant(this.db, PLATFORM_CONTEXT, async (tx) => {
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
        jitterWindowMs: REMINDER_JITTER_WINDOW_MS,
      };
    });
  }

  /**
   * Moves an open obligation on to `to` with an `obligation.status-changed.v1` event. A terminal
   * obligation (cancelled, filed) is left alone, and so is one already further on (roster ingest
   * moves statuses on too): both write the date-based status, so they converge. Returns the
   * status it has afterwards.
   */
  async setStatus(
    { obligationId, tenant }: ObligationRef,
    to: OpenStatus,
  ): Promise<ObligationStatus> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [row] = await tx
        .select({ tenant: filingObligations.tenant, status: filingObligations.status })
        .from(filingObligations)
        .where(eq(filingObligations.id, obligationId))
        .for('update');
      if (!row) {
        this.logger.warn({ obligationId }, 'Obligation of a running workflow not found');
        return 'cancelled';
      }
      if (!movesForward(row.status, to)) return row.status;
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

  /**
   * Records reminders whose day passed before they could be sent: never sent. One whose day was
   * already past when the obligation was created is `skipped-past-due-at-creation`; one whose day
   * came after (its workflow started, or woke, too late) is `skipped-missed`.
   */
  async recordSkipped(
    { obligationId, tenant }: ObligationRef,
    reminders: readonly { offsetDays: number; scheduledAt: string }[],
  ): Promise<void> {
    if (reminders.length === 0) return;
    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [row] = await tx
        .select({
          tenant: filingObligations.tenant,
          dueDate: filingObligations.dueDate,
          createdAt: filingObligations.createdAt,
        })
        .from(filingObligations)
        .where(eq(filingObligations.id, obligationId));
      if (!row) return;
      const createdOn = nairobiDate(row.createdAt);
      const recorded = await tx
        .insert(obligationReminders)
        .values(
          reminders.map((reminder) => ({
            obligationId,
            tenant: row.tenant,
            offsetDays: reminder.offsetDays,
            scheduledAt: new Date(reminder.scheduledAt),
            outcome:
              addDays(row.dueDate, -reminder.offsetDays) < createdOn
                ? ('skipped-past-due-at-creation' as const)
                : ('skipped-missed' as const),
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
          obligationReminderRecorded(row.tenant, {
            obligationId,
            offsetDays,
            channels: [],
            outcome,
          }),
        ),
      );
    });
  }

  /**
   * Sends one reminder of an obligation (SMS and email, recipient the linked person) and records
   * its outcome with an `obligation.reminder.recorded.v1` event:
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
    const recorded = await this.recordedOutcome(request);
    if (recorded) return recorded;
    const obligation = await this.reminderContext(request);
    if (!obligation || (obligation.status !== 'upcoming' && obligation.status !== 'due')) {
      return 'not-open';
    }
    const { personId } = obligation;
    if (personId === null) {
      return this.record(obligation.tenant, request, 'skipped-not-onboarded', {});
    }

    const progress: ChannelProgress = { ...attempt.progress };
    // The body of the first attempt, sent again by every retry (see `reminderMessages`).
    const params = await this.frozenParams(obligation.tenant, request, {
      type: obligation.type,
      commissionName: obligation.commissionName.slice(0, COMMISSION_NAME_MAX),
      statementDate: obligation.statementDate,
      dueDate: obligation.dueDate,
      daysLeft: daysLeft(nairobiDate(new Date(request.scheduledAt)), obligation.dueDate),
      portalUrl: config.PORTAL_URL,
    });
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
        if (error instanceof NotificationsKeyReused) {
          // Cannot happen while the body is frozen: another request took this reminder's key. A
          // message went out, or failed, under it; sending again under a new key could send it
          // twice, so the channel counts as failed, loudly.
          this.logger.error(
            {
              err: error,
              obligationId: request.obligationId,
              channel,
              idempotencyKey: reminderMessageKey(request, channel),
            },
            'Reminder key already used for another message',
          );
          progress[channel] = { status: 'failed', error: 'idempotency-key-reused' };
        } else if (error instanceof NotificationsRejected) {
          this.logger.error(
            { err: error, obligationId: request.obligationId, channel },
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

  /**
   * The template parameters the reminder sends: those its first attempt stored, else `rendered`,
   * stored now for every later attempt.
   */
  private async frozenParams(
    tenant: string,
    { obligationId, offsetDays }: ReminderRequest,
    rendered: ReminderParams,
  ): Promise<ReminderParams> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      await tx
        .insert(reminderMessages)
        .values({ obligationId, offsetDays, tenant, params: rendered })
        .onConflictDoNothing();
      const [row] = await tx
        .select({ params: reminderMessages.params })
        .from(reminderMessages)
        .where(
          and(
            eq(reminderMessages.obligationId, obligationId),
            eq(reminderMessages.offsetDays, offsetDays),
          ),
        );
      return row?.params ?? rendered;
    });
  }

  private async recordedOutcome(request: ReminderRequest): Promise<ReminderOutcome | undefined> {
    return withTenant(this.db, systemContext(request.tenant), (tx) => reminderOutcome(tx, request));
  }

  private async reminderContext({ obligationId, tenant }: ObligationRef) {
    const [row] = await withTenant(this.db, systemContext(tenant), (tx) =>
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
    return row && { ...row, commissionName: row.commissionName ?? fallbackIssuerCode(row.tenant) };
  }

  /** Writes the reminder row and its event once; a row already there wins. */
  private async record(
    tenant: string,
    request: ReminderRequest,
    outcome: ReminderOutcome,
    sent: { channels?: MessageChannel[]; messageIds?: string[]; sentAt?: Date },
  ): Promise<ReminderOutcome> {
    const { obligationId, offsetDays } = request;
    const channels = sent.channels ?? [];
    return withTenant(this.db, systemContext(tenant), async (tx: Transaction) => {
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
      if (inserted.length === 0) return (await reminderOutcome(tx, request)) ?? outcome;
      await this.events.record(
        tx,
        obligationReminderRecorded(tenant, { obligationId, offsetDays, channels, outcome }),
      );
      return outcome;
    });
  }
}

/** The outcome recorded for the reminder, if any. */
async function reminderOutcome(
  tx: Transaction,
  { obligationId, offsetDays }: ReminderRequest,
): Promise<ReminderOutcome | undefined> {
  const [row] = await tx
    .select({ outcome: obligationReminders.outcome })
    .from(obligationReminders)
    .where(
      and(
        eq(obligationReminders.obligationId, obligationId),
        eq(obligationReminders.offsetDays, offsetDays),
      ),
    );
  return row?.outcome;
}

/** Namespace of the reminder messages' idempotency keys (UUID v5). */
const REMINDER_KEY_NAMESPACE = '5b8f2c1e-3d4a-4e6f-9a7b-0c1d2e3f4a5b';

/** The `Idempotency-Key` of one channel of one reminder: a UUID derived from both. */
export function reminderMessageKey(request: ReminderRequest, channel: MessageChannel): string {
  return uuidv5(
    `${request.obligationId}:${String(request.offsetDays)}:${channel}`,
    REMINDER_KEY_NAMESPACE,
  );
}

/** Whole days from `today` to the due date, within the template's 0 to 366. */
function daysLeft(today: CivilDate, dueDate: CivilDate): number {
  return Math.min(DAYS_LEFT_MAX, Math.max(0, daysBetween(today, dueDate)));
}
