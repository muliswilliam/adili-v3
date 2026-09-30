import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import { TENANT_SLUG } from './access.js';
import { CommissionRefs } from './commission-refs.js';
import {
  COMMISSION_CREATED,
  DECLARANT_ONBOARDED,
  POLICY_CHANGED,
  ROSTER_EXITS_CONFIRMED,
  ROSTER_IMPORT_COMPLETED,
} from './events.js';
import { type IngestedEvent, RosterIngest } from './roster-ingest.js';

const tenantSchema = z.string().regex(TENANT_SLUG);

const importCompletedData = z.object({ importId: z.uuid() });
const exitsConfirmedData = z.object({ batchId: z.uuid() });
const declarantOnboardedData = z.object({ rosterRecordId: z.uuid() });
const policyChangedData = z.object({ policyVersionId: z.uuid(), version: z.int().positive() });
const commissionCreatedData = z.object({ commissionId: z.uuid(), slug: z.string() });

/**
 * The directory's events the obligations follow (spec 04): the roster events that change who owes
 * what, policy changes, and new Commissions. Events carry ids only; records, policies and
 * Commission names are pulled (`RosterIngest`, `CommissionRefs`). Each consumer handles an event once (inbox); a handler that throws is retried
 * once, then dead-lettered.
 */
@Controller()
export class DirectoryEventsConsumer {
  constructor(
    private readonly ingest: RosterIngest,
    private readonly commissions: CommissionRefs,
  ) {}

  /** A new Commission: listed (with zero counts) in the national summary before any roster. */
  @OnEvent(COMMISSION_CREATED)
  async commissionCreated(@Payload() event: EventEnvelope): Promise<void> {
    commissionCreatedData.parse(event.data);
    await this.commissions.created('obligations.commission-created', ingested(event));
  }

  /** The records the import had rows for: new declarants, changed dates, reversed exits. */
  @OnEvent(ROSTER_IMPORT_COMPLETED)
  async importCompleted(@Payload() event: EventEnvelope): Promise<void> {
    const { importId } = importCompletedData.parse(event.data);
    await this.ingest.ingest('obligations.roster-import-completed', ingested(event), {
      kind: 'records',
      selector: { importId },
    });
  }

  /**
   * The records the confirmation exited: each gets its final obligation, and loses the biennials
   * whose statement date is after its exit date.
   */
  @OnEvent(ROSTER_EXITS_CONFIRMED)
  async exitsConfirmed(@Payload() event: EventEnvelope): Promise<void> {
    const { batchId } = exitsConfirmedData.parse(event.data);
    await this.ingest.ingest('obligations.roster-exits-confirmed', ingested(event), {
      kind: 'records',
      selector: { exitBatchId: batchId },
    });
  }

  /** The record's declarant onboarded: person id and OFR go onto its obligations. */
  @OnEvent(DECLARANT_ONBOARDED)
  async declarantOnboarded(@Payload() event: EventEnvelope): Promise<void> {
    const { rosterRecordId } = declarantOnboardedData.parse(event.data);
    await this.ingest.ingest('obligations.declarant-onboarded', ingested(event), {
      kind: 'record',
      recordId: rosterRecordId,
    });
  }

  /**
   * A new policy version is in force: the cached policy is pulled again (ADR-013 §2) and the
   * Commission's roster reconciled with it (a moved obligations-start date).
   */
  @OnEvent(POLICY_CHANGED)
  async policyChanged(@Payload() event: EventEnvelope): Promise<void> {
    policyChangedData.parse(event.data);
    await this.ingest.refreshPolicy('obligations.policy-changed', ingested(event));
  }
}

function ingested(event: EventEnvelope): IngestedEvent {
  return { id: event.id, tenant: tenantSchema.parse(event.tenant), time: new Date(event.time) };
}
