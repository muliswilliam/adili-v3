import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { eventEnvelopeSchema, OnEvent } from '@adili/events';

import { AuditTrail } from './audit-trail.js';

/**
 * Every event on the exchange (`#`): audit events (`audit.read.v1`, `audit.verification.v1`,
 * `audit.demo-switch.v1`) and every domain event, the record of the write it was published with
 * (ADR-008). Each is appended once; an envelope that does not parse is retried once, then
 * dead-lettered for inspection.
 */
@Controller()
export class IngestConsumer {
  constructor(private readonly trail: AuditTrail) {}

  @OnEvent('#')
  async ingest(@Payload() event: unknown): Promise<void> {
    await this.trail.append(eventEnvelopeSchema.parse(event));
  }
}
