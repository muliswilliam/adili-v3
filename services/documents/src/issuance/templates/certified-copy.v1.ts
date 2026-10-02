import { declarationSchemes } from '@adili/numbering/references';
import { CERTIFIED_COPY } from '@adili/events/contracts';
import { DeclarationSchema } from '@adili/forms';
import { z } from 'zod';

import { attestation, CONTENT_STYLES, declarationContent } from './declaration-content.js';
import {
  DECLARATION_DOCUMENT_STYLES,
  esc,
  formatDate,
  formatDateTime,
  htmlDocument,
  INK,
  LETTERHEAD_STYLES,
  letterhead,
  signatureNote,
  verificationPanel,
} from './page.js';
import { commissionRefSchema, DECLARATION_TYPES, isDeclarationReference } from './references.js';
import type { DocumentTemplate } from './template.js';

/**
 * What the access service hands over for a declarant's certified copy (spec 10): the
 * declarations service's full document of the version (`FullVersionDocument`, less its
 * identifiers and hash). Never stored beyond the PDF.
 */
export const certifiedCopyPayload = z
  .object({
    commission: commissionRefSchema,
    /** As declared in the version (first, other and surname). */
    declarantName: z.string().trim().min(1).max(200),
    reference: z
      .string()
      .refine(isDeclarationReference, {
        message: 'Must be a declaration reference number with a valid check character',
      })
      .meta({ description: 'Declaration reference number (ADR-011), e.g. DCB-PSC-2027-0000001-1' }),
    version: z.int().min(1),
    type: z.enum(DECLARATION_TYPES),
    statementDate: z.iso.date(),
    submittedAt: z.iso.datetime({ offset: true }),
    /** The immutable `declaration.v1` document of the version as submitted, decrypted. */
    document: DeclarationSchema,
  })
  .refine(
    (payload) =>
      !isDeclarationReference(payload.reference) ||
      payload.reference.startsWith(`${declarationSchemes[payload.type].code}-`),
    { message: "The reference number is not of the declaration's type", path: ['reference'] },
  )
  .meta({
    description:
      "Payload of certified-copy v1: the declarations service's full document of a submitted version (FullVersionDocument without its identifiers and hash)",
  });

export type CertifiedCopyPayload = z.infer<typeof certifiedCopyPayload>;

const STYLES = `${LETTERHEAD_STYLES}${CONTENT_STYLES}${DECLARATION_DOCUMENT_STYLES}
.vpill{flex:none;padding:1.2mm 3.2mm;border-radius:999px;background:${INK};color:#fff;font-weight:600;font-size:8.6pt}
.certify{padding:4mm 5mm;border-radius:2mm;background:#f6f5f3;margin:4mm 0}`;

/**
 * A certified copy of a submitted declaration version (spec 10, Administrative Mechanism 32):
 * the declarant's own record in full, restricted (the verify page shows reference, type,
 * Commission and date only).
 */
export const certifiedCopyV1: DocumentTemplate<CertifiedCopyPayload> = {
  type: CERTIFIED_COPY,
  version: 1,
  disclosureLevel: 'restricted',
  title: 'Certified copy',
  requires: { subjectPerson: true },
  payload: certifiedCopyPayload,

  reference(payload) {
    return payload.reference;
  },

  subjectVersion(payload) {
    return payload.version;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: CERTIFIED_COPY,
      issuerName: payload.commission.name,
      issuerCode: payload.commission.issuerCode,
      issuedAt: issuedAt.toISOString(),
      reference: payload.reference,
      version: payload.version,
    };
  },

  footer(payload) {
    return {
      issuerName: payload.commission.name,
      reference: payload.reference,
      version: payload.version,
      mark: 'CERTIFIED COPY',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const { commission } = payload;
    const scheme = declarationSchemes[payload.type];
    const fileNumber = payload.document.officer.employment.personnelFileNumber
      ? `<dt>Personnel file number</dt><dd>${esc(payload.document.officer.employment.personnelFileNumber)}</dd>`
      : '';
    const body = `${letterhead({ name: commission.name, code: commission.issuerCode })}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Certified copy</div><div class="doc-sub">Declaration of income, assets and liabilities</div></div>
<div class="ref"><div><div class="lbl">Reference number</div><div class="big mono nw">${esc(payload.reference)}</div></div><div class="vpill">Version ${payload.version}</div></div>
<dl class="skv">
<dt>Declarant</dt><dd>${esc(payload.declarantName)}</dd>
${fileNumber}
<dt>Responsible Commission</dt><dd>${esc(commission.name)} (${esc(commission.issuerCode)})</dd>
<dt>Declaration</dt><dd>${scheme.name}</dd>
<dt>Statement date</dt><dd>${esc(formatDate(payload.statementDate))}</dd>
<dt>Submitted</dt><dd>${esc(formatDateTime(payload.submittedAt))}</dd>
</dl>
<div class="certify">Certified a true copy of version ${payload.version} of this declaration as submitted through Adili Online and held by the ${esc(commission.name)}, issued to the declarant on ${esc(formatDate(issuedAt))}.</div>
${declarationContent(payload.document, { householdIdentifiers: true })}
${attestation(payload.document)}
${verificationPanel('copy', verificationId, 'The check shows only the reference, type, Commission and date.')}
<div class="signed">${signatureNote(signerName, issuedAt)}</div>`;
    return htmlDocument(`Certified copy ${payload.reference}`, STYLES, body);
  },
};
