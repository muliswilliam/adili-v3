import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type EventEnvelope, OnEvent } from '@adili/events';
import { DOCUMENT_ISSUED, DOCUMENT_REVOKED, DOCUMENT_SUPERSEDED } from '@adili/events/contracts';

import {
  documentIssuedData,
  documentRevokedData,
  documentSupersededData,
  VerificationProjection,
} from './projection.js';

/**
 * The documents service's issuance events, the projection's only input (ADR-010 §5). Each is
 * handled once (inbox); an event whose data does not parse is retried once, then dead-lettered.
 */
@Controller()
export class ProjectionConsumer {
  constructor(private readonly projection: VerificationProjection) {}

  @OnEvent(DOCUMENT_ISSUED)
  async issued(@Payload() event: EventEnvelope): Promise<void> {
    await this.projection.apply(
      'verification.document-issued',
      event,
      documentIssuedData.parse(event.data),
    );
  }

  @OnEvent(DOCUMENT_SUPERSEDED)
  async superseded(@Payload() event: EventEnvelope): Promise<void> {
    await this.projection.apply(
      'verification.document-superseded',
      event,
      documentSupersededData.parse(event.data),
    );
  }

  @OnEvent(DOCUMENT_REVOKED)
  async revoked(@Payload() event: EventEnvelope): Promise<void> {
    await this.projection.apply(
      'verification.document-revoked',
      event,
      documentRevokedData.parse(event.data),
    );
  }
}
