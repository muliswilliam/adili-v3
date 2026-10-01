import { declarationSchemes } from '@adili/numbering/references';
import { CERTIFIED_COPY } from '@adili/events/contracts';
import { DeclarationSchema } from '@adili/forms';
import { z } from 'zod';

import { attestation, CONTENT_STYLES, declarationContent } from './declaration-content.js';
import {
  esc,
  formatDate,
  formatDateTime,
  htmlDocument,
  INK,
  LETTERHEAD_STYLES,
  letterhead,
  LINE,
  MUTED,
  SOFT,
  signatureNote,
} from './page.js';
import { DECLARATION_TYPES, isDeclarationReference } from './references.js';
import type { DocumentTemplate } from './template.js';

/**
 * What the access service hands over for a declarant's certified copy (spec 10): the
 * declarations service's full document of the version and the issuing Commission. Never stored
 * beyond the PDF.
 */
export const certifiedCopyPayload = z
  .object({
    commissionName: z.string().trim().min(1).max(200),
    /** The Commission's issuer code, as in the reference number (`PSC`). */
    issuerCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
    declarantName: z.string().trim().min(1).max(200),
    personnelFileNumber: z.string().trim().min(1).max(30).nullable(),
    declarationType: z.enum(DECLARATION_TYPES),
    reference: z
      .string()
      .refine(isDeclarationReference, {
        message: 'Must be a declaration reference number with a valid check character',
      })
      .meta({ description: 'Declaration reference number (ADR-011), e.g. DCB-PSC-2027-0000001-1' }),
    version: z.int().min(1),
    statementDate: z.iso.date(),
    submittedAt: z.iso.datetime({ offset: true }),
    late: z.boolean(),
    /** The filing obligation's due date; null when the declaration has none. */
    dueDate: z.iso.date().nullable(),
    /** The immutable `declaration.v1` document of the version, decrypted. */
    document: DeclarationSchema,
  })
  .refine(
    (payload) =>
      !isDeclarationReference(payload.reference) ||
      payload.reference.startsWith(`${declarationSchemes[payload.declarationType].code}-`),
    { message: "The reference number is not of the declaration's type", path: ['reference'] },
  )
  .meta({
    description:
      "Payload of certified-copy v1: the declarations service's full document of a submitted version, with the issuing Commission",
  });

export type CertifiedCopyPayload = z.infer<typeof certifiedCopyPayload>;

const STYLES = `${LETTERHEAD_STYLES}${CONTENT_STYLES}
body{font-size:9.2pt;line-height:1.45}
p{margin:0 0 2.5mm}
.doc-h{margin:7mm 0 5mm}
.doc-h .t1{font-size:17pt;font-weight:700;letter-spacing:-0.01em;line-height:1.2}
.doc-sub{color:${SOFT};font-size:10pt;margin-top:1mm}
.fine{font-size:8.2pt;color:${SOFT}}
.ref{display:flex;align-items:center;justify-content:space-between;gap:4mm;padding:4.5mm 5mm;border:0.35mm solid ${INK};border-radius:2mm}
.lbl{font-size:7.4pt;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}}
.ref .big{font-size:16pt;font-weight:700;margin-top:0.5mm}
.vpill{flex:none;padding:1.2mm 3.2mm;border-radius:999px;background:${INK};color:#fff;font-weight:600;font-size:8.6pt}
.skv{display:grid;grid-template-columns:44mm 1fr;margin:5mm 0}
.skv dt,.skv dd{margin:0;padding:1.6mm 0;border-bottom:0.25mm solid ${LINE}}
.skv dt{color:${MUTED}}
.skv dd{font-weight:500}
.late{display:inline-block;padding:0 1.6mm;margin-right:1.4mm;border-radius:0.8mm;background:#fdeceb;color:#b3241a;font-weight:700;font-size:8pt}
.certify{padding:4mm 5mm;border-radius:2mm;background:#f6f5f3;margin:4mm 0}
.vpanel{padding:5mm;border-radius:2mm;background:#f6f5f3;margin:6mm 0 4mm;break-inside:avoid}
.vpanel .t{font-size:11pt;font-weight:700;margin-bottom:1.5mm}
.vpanel .vcode{font-size:12pt;font-weight:700;letter-spacing:0.03em;margin:1.5mm 0 2mm}
.signed{display:flex;justify-content:flex-end;break-inside:avoid}`;

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
      issuerName: payload.commissionName,
      issuerCode: payload.issuerCode,
      issuedAt: issuedAt.toISOString(),
      reference: payload.reference,
      version: payload.version,
    };
  },

  footer(payload) {
    return {
      issuerName: payload.commissionName,
      reference: payload.reference,
      version: payload.version,
      mark: 'CERTIFIED COPY',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const scheme = declarationSchemes[payload.declarationType];
    const due = payload.dueDate ? `${esc(formatDate(payload.dueDate))}. ` : '';
    const dueDate = payload.late
      ? `<span class="late">LATE</span>${due}Submitted after the due date`
      : `${due}Submitted on time`;
    const fileNumber = payload.personnelFileNumber
      ? `<dt>Personnel file number</dt><dd>${esc(payload.personnelFileNumber)}</dd>`
      : '';
    const body = `${letterhead({ name: payload.commissionName, code: payload.issuerCode })}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Certified copy</div><div class="doc-sub">Declaration of income, assets and liabilities</div></div>
<div class="ref"><div><div class="lbl">Reference number</div><div class="big mono nw">${esc(payload.reference)}</div></div><div class="vpill">Version ${payload.version}</div></div>
<dl class="skv">
<dt>Declarant</dt><dd>${esc(payload.declarantName)}</dd>
${fileNumber}
<dt>Responsible Commission</dt><dd>${esc(payload.commissionName)} (${esc(payload.issuerCode)})</dd>
<dt>Declaration</dt><dd>${scheme.name}</dd>
<dt>Statement date</dt><dd>${esc(formatDate(payload.statementDate))}</dd>
<dt>Submitted</dt><dd>${esc(formatDateTime(payload.submittedAt))}</dd>
<dt>Due date</dt><dd>${dueDate}</dd>
</dl>
<div class="certify">Certified a true copy of version ${payload.version} of this declaration as submitted through Adili Online and held by the ${esc(payload.commissionName)}, issued to the declarant on ${esc(formatDate(issuedAt))}.</div>
${declarationContent(payload.document, { householdIdentifiers: true })}
${attestation(payload.document)}
<div class="vpanel"><div class="t">Check that this copy is genuine</div><div>Scan the QR code at the foot of any page, or go to the Adili Online verify page and enter:</div><div class="vcode mono nw">${esc(verificationId)}</div><div class="fine">The check shows only the reference, type, Commission and date.</div></div>
<div class="signed">${signatureNote(signerName, issuedAt)}</div>`;
    return htmlDocument(`Certified copy ${payload.reference}`, STYLES, body);
  },
};
