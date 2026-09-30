import { canonicalJson } from '@adili/api-kit';
import type { DisclosureLevel, DocumentStatus, PublicPayload } from '@adili/events/contracts';

import type { OpenBao } from './openbao.js';

/** Transit key (Ed25519) signing verification records; created by the demo CA script. */
export const RECORD_SIGNING_KEY = 'documents-record-signing';

/**
 * What a verification record's signature covers (ADR-010 §3): everything a verifier relies on,
 * so an edit of any of it in the database is detectable.
 */
export interface SignedRecord {
  verificationId: string;
  documentId: string;
  documentType: string;
  templateVersion: number;
  disclosureLevel: DisclosureLevel;
  issuerTenant: string;
  issuedAt: string;
  sha256: string;
  publicPayload: PublicPayload | null;
  status: DocumentStatus;
  statusReasonCategory: string | null;
  /** Verification id of the newer document, once superseded. */
  supersededBy: string | null;
  statusChangedAt: string | null;
  expiresAt: string | null;
}

/** The bytes signed: the record as JSON with keys sorted at every level. */
export function canonicalRecord(record: SignedRecord): Buffer {
  return Buffer.from(canonicalJson(record), 'utf8');
}

export interface RecordSignature {
  /** Base64 Ed25519 signature over `canonicalRecord`. */
  signature: string;
  keyVersion: number;
}

/** Ed25519 signatures over verification records through OpenBao Transit. */
export class RecordSigner {
  constructor(private readonly openbao: OpenBao) {}

  async sign(record: SignedRecord): Promise<RecordSignature> {
    const { signature, keyVersion } = await this.openbao.sign(
      RECORD_SIGNING_KEY,
      canonicalRecord(record),
    );
    return { signature: signature.toString('base64'), keyVersion };
  }
}
