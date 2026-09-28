import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import { DECLARANT_ONBOARDED, ROSTER_IMPORT_COMPLETED } from './events.js';
import { type IngestedEvent, RosterIngest } from './roster-ingest.js';

const tenantSchema = z.string().regex(/^[a-z][a-z0-9]{1,19}$/);

const importCompletedData = z.object({ importId: z.uuid() });
const declarantOnboardedData = z.object({ rosterRecordId: z.uuid() });

/**
 * The directory's roster events that change who owes what (spec 04). Events carry ids only; the
 * records are pulled (`RosterIngest`). Each consumer handles an event once (inbox); a handler that
 * throws is retried once, then dead-lettered.
 */
@Controller()
export class RosterEventsConsumer {
  constructor(private readonly ingest: RosterIngest) {}

  /** The records the import had rows for: new officers, changed dates, reversed exits. */
  @OnEvent(ROSTER_IMPORT_COMPLETED)
  async importCompleted(@Payload() event: EventEnvelope): Promise<void> {
    const { importId } = importCompletedData.parse(event.data);
    await this.ingest.ingest('obligations.roster-import-completed', ingested(event), {
      kind: 'records',
      selector: { importId },
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
}

function ingested(event: EventEnvelope): IngestedEvent {
  return { id: event.id, tenant: tenantSchema.parse(event.tenant) };
}
