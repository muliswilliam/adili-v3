import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE } from '@adili/data-access';

import { requireTransactionEnded } from '../activity-failures.js';
import { Clock, nairobiDate } from '../clock.js';
import type { AccessDatabase } from '../db/database.js';
import { loadLea } from '../lea/activities.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { declarantNoticesUrl } from '../requests/links.js';
import { DECIDED_STATUSES } from '../requests/schema.js';
import { CHANNELS, load, messageKey, send } from '../requests/workflow-support.js';
import type { OnboardedNoticeOutcome, OnboardedNoticeWorkflowInput } from './contract.js';

/**
 * The activity of `OnboardedNoticeWorkflow`, hosted by the access worker (every public method is
 * an activity named after it: keep helpers out of the class). Safe to retry: it reads the request,
 * and each message carries the key the request's own workflow sends it with, so a declarant told
 * online already (e.g. of a decision taken after the link) is not told twice.
 */
@Injectable()
export class OnboardedNoticeActivities {
  private readonly logger = new Logger(OnboardedNoticeActivities.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly notifications: NotificationsClient,
    private readonly clock: Clock,
  ) {}

  /**
   * A declarant served in writing (r.22(2), r.23(2)) has onboarded and the request is linked to
   * them: they are told online, by email and SMS, what the written notice told them, while it
   * still matters. Form K: the notice with the last day of their window, while it is open; the
   * outcome, once decided. Between the two (window closed, no decision yet) nothing: the
   * decision's notice reaches them when it is taken, now they have an account. Law enforcement:
   * the grant (the only notice a declarant gets of one).
   */
  async onlineNoticeAfterWrittenNotice(
    input: OnboardedNoticeWorkflowInput,
  ): Promise<OnboardedNoticeOutcome> {
    await requireTransactionEnded(this.db, input.transactionId);
    const { tenant, requestId } = input;
    const sendAll = async (
      about: { id: string },
      personId: string,
      template: 'access-decision-declarant' | 'access-request-notified' | 'lea-grant-notice',
      key: string,
      params: Record<string, string>,
    ) => {
      for (const channel of CHANNELS) {
        await send(this.notifications, this.logger, about, {
          channel,
          recipient: { kind: 'person', personId },
          template: `${template}-${channel}`,
          params: { ...params, signInUrl: declarantNoticesUrl() },
          tenant,
          idempotencyKey: messageKey(requestId, `${key}:${channel}`),
        });
      }
    };

    if (input.requestKind === 'lea') {
      const found = await loadLea(this.db, tenant, requestId);
      if (!found) return 'missing';
      const { resolvedPersonId: personId, decision } = found;
      if (
        personId === null ||
        found.writtenNotice === null ||
        found.status !== 'granted' ||
        decision === null
      ) {
        return 'not-relevant';
      }
      await sendAll(found, personId, 'lea-grant-notice', 'lea-grant-notice', {
        reference: found.reference,
        commissionName: found.commissionName,
        agencyName: found.agencyName,
        grantedOn: nairobiDate(new Date(decision.decidedAt)),
      });
      return 'grant-notice';
    }

    const found = await load(this.db, tenant, requestId);
    if (!found) return 'missing';
    const personId = found.resolvedPersonId;
    if (personId === null || found.writtenNotice === null) return 'not-relevant';
    const common = { reference: found.reference, commissionName: found.commissionName };
    if ((DECIDED_STATUSES as readonly string[]).includes(found.status)) {
      await sendAll(found, personId, 'access-decision-declarant', 'decision-declarant', {
        ...common,
        outcome: found.status,
      });
      return 'decision';
    }
    const windowEndsAt = found.windowEndsAt;
    if (
      found.status !== 'awaiting-representations' ||
      windowEndsAt === null ||
      windowEndsAt.getTime() <= this.clock.now().getTime()
    ) {
      return 'not-relevant';
    }
    await sendAll(found, personId, 'access-request-notified', 'notified', {
      ...common,
      // A written notice's window ends at midnight: its last day is the day before.
      respondBy: nairobiDate(new Date(windowEndsAt.getTime() - 1)),
    });
    return 'notice';
  }
}
