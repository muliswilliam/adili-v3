import { type FieldCipher, FieldCipherError, type FieldEnvelope } from '@adili/data-access';
import type { FormKV1 } from '@adili/forms';

import type { ApplicantFacts } from '../directory/directory-client.js';
import { keyServiceUnavailable } from '../problems.js';
import type { accessRequests } from './schema.js';

/**
 * A request's Form K at rest: the `form-k.v1` document as the applicant submitted it, without
 * `meta` (its reference and submission time live in the request's columns and are filled back
 * in when it is shown), encrypted under the Commission's key and bound to the request's id.
 */

/** The record id bound into a request's encrypted Form K (AAD). */
export function formKRecordId(requestId: string): string {
  return `access-request:${requestId}`;
}

/** The document without `meta`, which the service fills, never the applicant. */
export function withoutMeta(document: FormKV1): FormKV1 {
  const copy: FormKV1 = { ...document };
  delete copy.meta;
  return copy;
}

/**
 * The document with Part I's particulars (name, identity document, telephone and email) taken
 * from the applicant's directory record, whatever the body said: the portal pre-fills them from
 * the account, and an API caller cannot file under another name (a package's watermark names its
 * recipient, ADR-010 §6). A contact the directory holds none of keeps the applicant's entry; the
 * addresses and occupation are the applicant's own.
 */
export function withApplicantParticulars(document: FormKV1, applicant: ApplicantFacts): FormKV1 {
  const { kind, number, country } = applicant.identityDocument;
  return {
    ...document,
    partI: {
      ...document.partI,
      name: applicant.fullName,
      identityDocument: country === null ? { kind, number } : { kind, number, country },
      telephone: applicant.contacts.phone ?? document.partI.telephone,
      email: applicant.contacts.email ?? document.partI.email,
    },
  };
}

/** Encrypts the Form K of request `requestId` of `tenant`; 503 when the key service is down. */
export async function sealFormK(
  cipher: FieldCipher,
  tenant: string,
  requestId: string,
  document: FormKV1,
): Promise<{ formKCiphertext: string; formKEnvelope: FieldEnvelope }> {
  try {
    const sealed = await cipher.encrypt({
      tenant,
      recordId: formKRecordId(requestId),
      plaintext: JSON.stringify(withoutMeta(document)),
    });
    return { formKCiphertext: sealed.ciphertext, formKEnvelope: sealed.envelope };
  } catch (error) {
    if (error instanceof FieldCipherError && error.code === 'unavailable') {
      throw keyServiceUnavailable();
    }
    throw error;
  }
}

/** The request's Form K as submitted, with `meta` filled from its reference and receipt. */
export async function openFormK(
  cipher: FieldCipher,
  row: Pick<
    typeof accessRequests.$inferSelect,
    'id' | 'tenant' | 'reference' | 'submittedAt' | 'formKCiphertext' | 'formKEnvelope'
  >,
): Promise<FormKV1> {
  try {
    const plaintext = await cipher.decrypt({
      tenant: row.tenant,
      recordId: formKRecordId(row.id),
      ciphertext: row.formKCiphertext,
      envelope: row.formKEnvelope,
    });
    const document = JSON.parse(plaintext.toString('utf8')) as FormKV1;
    return {
      ...document,
      meta: { reference: row.reference, submittedAt: row.submittedAt.toISOString() },
    };
  } catch (error) {
    if (error instanceof FieldCipherError && error.code === 'unavailable') {
      throw keyServiceUnavailable();
    }
    throw error;
  }
}
