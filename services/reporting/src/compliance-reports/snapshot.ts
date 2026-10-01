import type { FieldCipher, FieldEnvelope, SealedField } from '@adili/data-access';
import type { FormMV1 } from '@adili/forms';

/**
 * The report's `form-m.v1` document, kept only encrypted under the Commission's key (ADR-006),
 * bound to the report's id so a snapshot cannot be moved to another report.
 */

export function sealSnapshot(
  cipher: FieldCipher,
  tenant: string,
  reportId: string,
  document: FormMV1,
): Promise<SealedField> {
  return cipher.encrypt({ tenant, recordId: reportId, plaintext: JSON.stringify(document) });
}

/** The report's document, or null before the first compile saved one. */
export async function openSnapshot(
  cipher: FieldCipher,
  tenant: string,
  report: { id: string; snapshotCiphertext: string | null; envelope: FieldEnvelope | null },
): Promise<FormMV1 | null> {
  if (report.snapshotCiphertext === null || report.envelope === null) return null;
  const plaintext = await cipher.decrypt({
    tenant,
    recordId: report.id,
    ciphertext: report.snapshotCiphertext,
    envelope: report.envelope,
  });
  return JSON.parse(plaintext.toString('utf8')) as FormMV1;
}
