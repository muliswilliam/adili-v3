import {
  COMPLIANCE_REPORT_RECEIPT,
  type DocumentType,
  FORM_M,
  REFERRAL_PACKAGE,
} from '@adili/events/contracts';
import { EACC_ROLES } from '@adili/roles';

/**
 * The documents of every Commission EACC opens, with a token of the EACC tenant, by the EACC roles
 * that open them (spec 09): a Commission's submitted Form M and its acknowledgement of receipt
 * (S9, EACC's intake reads submitted reports and receipts across Commissions) and the
 * Confidential referral packages Commissions send EACC (S12). No other Commission document is
 * EACC's. The database admits the EACC tenant to these types only (issued_documents_eacc_read).
 */
const EACC_READERS: Partial<Record<DocumentType, readonly string[]>> = {
  [FORM_M]: EACC_ROLES,
  [COMPLIANCE_REPORT_RECEIPT]: EACC_ROLES,
  [REFERRAL_PACKAGE]: EACC_ROLES,
};

/** The document types an EACC account holding `roles` opens from any Commission. */
export function eaccReadableTypes(roles: readonly string[]): DocumentType[] {
  return (Object.keys(EACC_READERS) as DocumentType[]).filter((type) =>
    EACC_READERS[type]?.some((role) => roles.includes(role)),
  );
}
