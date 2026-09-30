import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { type EventEnvelope, OnEvent } from '@adili/events';
import {
  DOCUMENT_ISSUED,
  VERIFICATION_CHECKED,
  VERIFICATION_OUTCOMES,
  type VerificationCheckedData,
} from '@adili/events/contracts';
import { z } from 'zod';

import { AcknowledgementService, type IssuedDocument } from './acknowledgement.service.js';

/** The fields of `document.issued.v1` the acknowledgement reads, validated. */
const documentIssuedData = z.object({
  documentId: z.uuid(),
  verificationId: z.string().min(1).max(40),
  verifyUrl: z.url(),
  documentType: z.string().min(1),
  issuerTenant: z.string().regex(TENANT_KEY),
  subjectRef: z.string().min(1),
  issuedAt: z.iso.datetime({ offset: true }),
}) satisfies z.ZodType<IssuedDocument>;

const verificationCheckedData = z.object({
  verificationId: z.string().min(1).max(40),
  outcome: z.enum(VERIFICATION_OUTCOMES),
}) satisfies z.ZodType<VerificationCheckedData>;

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
    await this.acknowledgements.verified(event, verificationCheckedData.parse(event.data));
  }
}
