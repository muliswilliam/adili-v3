import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { type EventEnvelope, OnEvent } from '@adili/events';
import {
  DOCUMENT_ISSUED,
  documentIssuedDataSchema,
  VERIFICATION_CHECKED,
  verificationCheckedDataSchema,
} from '@adili/events/contracts';
import { z } from 'zod';

import { AcknowledgementService, type IssuedDocument } from './acknowledgement.service.js';

/** The fields of `document.issued.v1` the acknowledgement reads, validated. */
const documentIssuedData = documentIssuedDataSchema
  .pick({
    documentId: true,
    verificationId: true,
    verifyUrl: true,
    documentType: true,
    issuerTenant: true,
    subjectRef: true,
    issuedAt: true,
  })
  // The issuer is the tenant the version is looked up in.
  .extend({ issuerTenant: z.string().regex(TENANT_KEY) }) satisfies z.ZodType<IssuedDocument>;

/**
 * The documents service's and verification-api's events about acknowledgement slips (spec 06):
 * the issued slip set on its version, and every lookup of its code counted. Each is handled once
 * (inbox); a handler that throws is retried once, then dead-lettered.
 */
@Controller()
export class AcknowledgementConsumer {
  constructor(private readonly acknowledgements: AcknowledgementService) {}

  @OnEvent(DOCUMENT_ISSUED)
  async documentIssued(@Payload() event: EventEnvelope): Promise<void> {
    await this.acknowledgements.issued(event, documentIssuedData.parse(event.data));
  }

  @OnEvent(VERIFICATION_CHECKED)
  async verificationChecked(@Payload() event: EventEnvelope): Promise<void> {
    await this.acknowledgements.verified(event, verificationCheckedDataSchema.parse(event.data));
  }
}
