import { Controller, Inject } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { DATABASE, switchTenant } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import type { AccessDatabase } from '../db/database.js';
import { type LinkedRequests, linkDeclarant } from '../declarant-account.js';
import { LeaRequestWorkflows } from '../lea/lea-workflows.js';
import { systemContext } from '../system-context.js';
import { AccessRequestWorkflows } from './request-workflows.js';

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
 * is told online. Linked requests show in the declarant's notices and who-accessed history.
 */
@Controller()
export class DeclarantOnboardedConsumer {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly formK: AccessRequestWorkflows,
    private readonly lea: LeaRequestWorkflows,
  ) {}

  @OnEvent(DECLARANT_ONBOARDED)
  async onboarded(@Payload() event: EventEnvelope): Promise<void> {
    const { personId, rosterRecordId } = declarantOnboardedData.parse(event.data);
    const tenant = z.string().regex(TENANT_KEY).parse(event.tenant);
    let linked: LinkedRequests = { formK: [], lea: [] };
    await consumeOnce(this.db, ONBOARDED_CONSUMER, event, async (tx) => {
      await switchTenant(tx, systemContext(tenant));
      linked = await linkDeclarant(tx, rosterRecordId, personId);
    });
    for (const requestId of linked.formK) await this.formK.signal(requestId, 'onboarded');
    for (const requestId of linked.lea) await this.lea.signal(requestId, 'onboarded');
  }
}
