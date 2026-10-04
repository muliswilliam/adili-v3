import {
  COMPLIANCE_REPORT_RECEIPT,
  type DocumentType,
  FORM_M,
  NATIONAL_CONSOLIDATED_REPORT,
  OPEN_DATA_MANIFEST,
  REFERRAL_PACKAGE,
} from '@adili/events/contracts';
import { EACC_ROLES, EACC_TENANT, FORM_M_ROLES, REPORTS_SUBMIT_SCOPE } from '@adili/roles';

/**
 * Who reads a document they are not the subject person of, by its type (spec 09 authorisation,
 * "read submitted report and receipt", S9, S11, S12). Every other document is its subject
 * person's, or an access officer's it names (issuance.service.ts `owned`).
 */
interface Readers {
  /**
   * The roles that read it, with a token of the tenant the table reads for: the document's own
   * (`OWN_TENANT_READERS`) or EACC's, across Commissions (`EACC_READERS`).
   */
  roles: readonly string[];
  /** Or the client scope that does, with a token of that tenant (a federated Commission's system). */
  scope?: string;
}

/**
 * The issuing tenant's own readers: a Commission's supervisor, commission-admin, reporting officer
 * and federated system read its submitted Form M and receipt; EACC's analysts and supervisors
 * EACC's national consolidated report and its open-data release manifests (issued for the EACC
 * tenant; anyone verifies a manifest).
 */
const OWN_TENANT_READERS: Partial<Record<DocumentType, Readers>> = {
  [FORM_M]: { roles: FORM_M_ROLES, scope: REPORTS_SUBMIT_SCOPE },
  [COMPLIANCE_REPORT_RECEIPT]: { roles: FORM_M_ROLES, scope: REPORTS_SUBMIT_SCOPE },
  [NATIONAL_CONSOLIDATED_REPORT]: { roles: EACC_ROLES },
  [OPEN_DATA_MANIFEST]: { roles: EACC_ROLES },
};

/**
 * The documents of every Commission EACC opens, with a token of the EACC tenant, by the EACC roles
 * that open them: a Commission's submitted Form M and its acknowledgement of receipt (S9, EACC's
 * intake reads submitted reports and receipts across Commissions) and the Confidential referral
 * packages Commissions send EACC (S12). No other Commission document is EACC's. The database
 * admits the EACC tenant to these types only (issued_documents_eacc_read).
 */
const EACC_READERS: Partial<Record<DocumentType, Readers>> = {
  [FORM_M]: { roles: EACC_ROLES },
  [COMPLIANCE_REPORT_RECEIPT]: { roles: EACC_ROLES },
  [REFERRAL_PACKAGE]: { roles: EACC_ROLES },
};

/** Who is asking: their token's tenant, roles and client scopes. */
export interface Reader {
  tenant: string | null;
  roles: readonly string[];
  scopes: readonly string[];
}

function readableTypes(
  readers: Partial<Record<DocumentType, Readers>>,
  { roles, scopes }: Reader,
): DocumentType[] {
  return (Object.keys(readers) as DocumentType[]).filter((type) => {
    const of = readers[type];
    return (
      of !== undefined &&
      (of.roles.some((role) => roles.includes(role)) ||
        (of.scope !== undefined && scopes.includes(of.scope)))
    );
  });
}

/** The document types `reader` opens of their own tenant's (none without a tenant). */
export function ownTenantReadableTypes(reader: Reader): DocumentType[] {
  return reader.tenant === null ? [] : readableTypes(OWN_TENANT_READERS, reader);
}

/** The document types `reader`, an EACC account, opens from any Commission (none for others). */
export function eaccReadableTypes(reader: Reader): DocumentType[] {
  return reader.tenant === EACC_TENANT ? readableTypes(EACC_READERS, reader) : [];
}
