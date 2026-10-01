import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type EventEnvelope, OnEvent } from '@adili/events';
import {
  DECLARATION_ACKNOWLEDGEMENT_REQUESTED,
  DECLARATION_SUBMITTED,
} from '@adili/events/contracts';
import { z } from 'zod';

import { AcknowledgementIssuer, type SlipRequest } from './acknowledgement-issuer.js';

/** The identifiers both events carry about the version (the rest is pulled). */
const slipRequest = z.object({
  declarationId: z.uuid(),
  versionId: z.uuid(),
  version: z.int().min(1),
  reference: z.string().min(1),
}) satisfies z.ZodType<SlipRequest>;

/**
 * The declarations service's asks for a version's acknowledgement slip (spec 06): on
 * submission, and again when the declarant asks for a slip that did not come. A handler that
 * throws is retried once, then dead-lettered.
 */
@Controller()
export class AcknowledgementConsumer {
  constructor(private readonly issuer: AcknowledgementIssuer) {}

  @OnEvent(DECLARATION_SUBMITTED)
  async submitted(@Payload() event: EventEnvelope): Promise<void> {
    await this.issuer.issue(
      'documents.declaration-submitted',
      event,
      slipRequest.parse(event.data),
    );
  }

  @OnEvent(DECLARATION_ACKNOWLEDGEMENT_REQUESTED)
  async requested(@Payload() event: EventEnvelope): Promise<void> {
    await this.issuer.issue(
      'documents.acknowledgement-requested',
      event,
      slipRequest.parse(event.data),
    );
  }
}
