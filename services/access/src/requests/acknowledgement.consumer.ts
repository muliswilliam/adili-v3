import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { type EventEnvelope, OnEvent } from '@adili/events';
import { ACCESS_REQUEST_RECEIVED } from '@adili/events/contracts';
import { z } from 'zod';

import { AcknowledgementService, type ReceivedRequest } from './acknowledgement.service.js';

/** The fields of `access.request.received.v1` the acknowledgement reads, validated. */
const receivedData = z.object({
  subjectKind: z.string(),
  subjectId: z.uuid(),
  tenant: z.string().regex(TENANT_KEY),
}) satisfies z.ZodType<ReceivedRequest>;

/**
 * The access service's own `access.request.received.v1`: the applicant is acknowledged. Handled
 * once per event (inbox); a handler that throws is retried once, then dead-lettered.
 */
@Controller()
export class AcknowledgementConsumer {
  constructor(private readonly acknowledgements: AcknowledgementService) {}

  @OnEvent(ACCESS_REQUEST_RECEIVED)
  async received(@Payload() event: EventEnvelope): Promise<void> {
    await this.acknowledgements.received(event, receivedData.parse(event.data));
  }
}
