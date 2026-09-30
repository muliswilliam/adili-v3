import { randomBytes, randomUUID } from 'node:crypto';

import { createEnvelope, type EventEnvelope } from '@adili/events';
import {
  DOCUMENT_ISSUED,
  DOCUMENT_REVOKED,
  DOCUMENT_SUPERSEDED,
  type DocumentIssuedData,
  type DocumentRevokedData,
  type DocumentSupersededData,
  newVerificationId,
  type RevocationReason,
} from '@adili/events/contracts';

export function sha256(): string {
  return randomBytes(32).toString('hex');
}

/** The data of `document.issued.v1` for an acknowledgement slip, as the documents service emits it. */
export function issuedData(overrides: Partial<DocumentIssuedData> = {}): DocumentIssuedData {
  const issuedAt = overrides.issuedAt ?? new Date().toISOString();
  const verificationId = overrides.verificationId ?? newVerificationId();
  return {
    documentId: randomUUID(),
    verificationId,
    verifyUrl: `http://localhost:3030/v/${verificationId}`,
    documentType: 'acknowledgement-slip',
    templateVersion: 1,
    disclosureLevel: 'restricted',
    issuerTenant: 'tsc',
    subjectRef: `declaration-version:${randomUUID()}`,
    publicPayload: {
      type: 'acknowledgement-slip',
      issuerName: 'Teachers Service Commission',
      issuerCode: 'TSC',
      issuedAt,
      reference: 'DCB-TSC-2027-0000001-B',
      version: 1,
    },
    sha256: sha256(),
    issuedAt,
    status: 'valid',
    ...overrides,
  };
}

export function issued(data: DocumentIssuedData): EventEnvelope<DocumentIssuedData> {
  return createEnvelope('adili/documents', {
    type: DOCUMENT_ISSUED,
    subject: data.documentId,
    tenant: data.issuerTenant,
    data,
  });
}

/** `document.superseded.v1` of `document` by `newer`, `afterMs` after it was issued. */
export function superseded(
  document: DocumentIssuedData,
  newer: DocumentIssuedData,
  afterMs = 60_000,
): EventEnvelope<DocumentSupersededData> {
  return createEnvelope('adili/documents', {
    type: DOCUMENT_SUPERSEDED,
    subject: document.documentId,
    tenant: document.issuerTenant,
    data: {
      ...document,
      status: 'superseded',
      supersededBy: newer.documentId,
      supersededByVerificationId: newer.verificationId,
      statusChangedAt: new Date(Date.parse(document.issuedAt) + afterMs).toISOString(),
    },
  });
}

export function revoked(
  document: DocumentIssuedData,
  reasonCategory: RevocationReason,
  afterMs = 60_000,
): EventEnvelope<DocumentRevokedData> {
  return createEnvelope('adili/documents', {
    type: DOCUMENT_REVOKED,
    subject: document.documentId,
    tenant: document.issuerTenant,
    data: {
      ...document,
      status: 'revoked',
      reasonCategory,
      statusChangedAt: new Date(Date.parse(document.issuedAt) + afterMs).toISOString(),
    },
  });
}
