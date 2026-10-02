import { Controller, Inject } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { DATABASE, switchTenant } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { and, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import { type LinkedRequests, linkDeclarant } from '../declarant-account.js';
import { LeaRequestWorkflows } from '../lea/lea-workflows.js';
import { leaRequests } from '../lea/schema.js';
import { OnboardedNoticeWorkflows } from '../onboarded-notices/onboarded-notice-workflows.js';
import { systemContext } from '../system-context.js';
import { currentTransactionId } from '../workflow-control.js';
import { AccessRequestWorkflows } from './request-workflows.js';
import { accessRequests } from './schema.js';

/** The directory's event: a roster record's officer onboarded as a declarant person. */
export const DECLARANT_ONBOARDED = 'declarant.onboarded.v1';

/** Inbox consumer of the onboardings linked. */
const ONBOARDED_CONSUMER = 'access.declarant-onboarded';

const declarantOnboardedData = z.object({ personId: z.uuid(), rosterRecordId: z.uuid() });

/**
 * A roster record's officer onboarded (the directory's `declarant.onboarded.v1`, in their
 * Commission): the requests resolved to that record while they had no account (spec 10 decision
 * 2) are linked to the person, once per event (inbox), and their workflows told: a Form K
 * request not yet notified in writing is notified online now, and a grant not yet told in writing
 * is told online. A request served in writing already starts `OnboardedNoticeWorkflow`, inside
 * the linking transaction (a Temporal outage rolls the link back and the event is redelivered),
 * so the declarant is also told online what the letter told them while it still matters. Linked
 * requests show in the declarant's notices and who-accessed history.
 */
@Controller()
export class DeclarantOnboardedConsumer {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly formK: AccessRequestWorkflows,
    private readonly lea: LeaRequestWorkflows,
    private readonly onboardedNotices: OnboardedNoticeWorkflows,
  ) {}

  @OnEvent(DECLARANT_ONBOARDED)
  async onboarded(@Payload() event: EventEnvelope): Promise<void> {
    const { personId, rosterRecordId } = declarantOnboardedData.parse(event.data);
    const tenant = z.string().regex(TENANT_KEY).parse(event.tenant);
    let linked: LinkedRequests = { formK: [], lea: [] };
    await consumeOnce(this.db, ONBOARDED_CONSUMER, event, async (tx) => {
      await switchTenant(tx, systemContext(tenant));
      linked = await linkDeclarant(tx, rosterRecordId, personId);
      await this.startOnboardedNotices(tx, tenant, linked);
    });
    for (const requestId of linked.formK) await this.formK.signal(requestId, 'onboarded');
    for (const requestId of linked.lea) await this.lea.signal(requestId, 'onboarded');
  }

  /** Starts `OnboardedNoticeWorkflow` for each linked request served in writing already. */
  private async startOnboardedNotices(
    tx: AccessTransaction,
    tenant: string,
    linked: LinkedRequests,
  ): Promise<void> {
    const formK =
      linked.formK.length === 0
        ? []
        : await tx
            .select({ id: accessRequests.id })
            .from(accessRequests)
            .where(
              and(
                inArray(accessRequests.id, linked.formK),
                isNotNull(accessRequests.writtenNotice),
              ),
            );
    const lea =
      linked.lea.length === 0
        ? []
        : await tx
            .select({ id: leaRequests.id })
            .from(leaRequests)
            .where(and(inArray(leaRequests.id, linked.lea), isNotNull(leaRequests.writtenNotice)));
    const served = [
      ...formK.map(({ id }) => ({ requestKind: 'form-k' as const, requestId: id })),
      ...lea.map(({ id }) => ({ requestKind: 'lea' as const, requestId: id })),
    ];
    if (served.length === 0) return;
    const transactionId = await currentTransactionId(tx);
    for (const request of served) {
      await this.onboardedNotices.start({ tenant, ...request, transactionId });
    }
  }
}
