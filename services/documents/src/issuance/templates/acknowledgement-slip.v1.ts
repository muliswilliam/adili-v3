import { type DeclarationType, declarationSchemes } from '@adili/numbering/references';
import { ACKNOWLEDGEMENT_SLIP } from '@adili/events/contracts';
import { z } from 'zod';

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
 * What the declarations service's acknowledgement payload endpoint returns for a submitted
 * version (spec 06): only what the slip prints.
 */
export const acknowledgementSlipPayload = z
  .object({
    declarantName: z.string().trim().min(1).max(200),
    commissionName: z.string().trim().min(1).max(200),
    /** The Commission's issuer code, as in the reference number (`PSC`). */
    issuerCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
    declarationType: z.enum(DECLARATION_TYPES),
    statementDate: z.iso.date(),
    /** The filing obligation's due date; null when the declaration has none. */
    dueDate: z.iso.date().nullable(),
    reference: z
      .string()
      .refine(isDeclarationReference, {
        message: 'Must be a declaration reference number with a valid check character',
      })
      .meta({ description: 'Declaration reference number (ADR-011), e.g. DCB-PSC-2027-0000001-1' }),
    version: z.int().min(1),
    submittedAt: z.iso.datetime({ offset: true }),
    late: z.boolean(),
    statementCount: z.int().min(0),
    itemCount: z.int().min(0),
  })
  .refine(
    // Only for a valid reference number: an invalid one is reported on its own.
    (payload) =>
      !isDeclarationReference(payload.reference) ||
      payload.reference.startsWith(`${declarationSchemes[payload.declarationType].code}-`),
    { message: "The reference number is not of the declaration's type", path: ['reference'] },
  )
  .meta({
    description:
      "Payload of acknowledgement-slip v1: what the declarations service's acknowledgement payload endpoint returns for a submitted version",
  });

export type AcknowledgementSlipPayload = z.infer<typeof acknowledgementSlipPayload>;

const STYLES = `${LETTERHEAD_STYLES}
body{font-size:9.6pt;line-height:1.45}
p{margin:0 0 3mm}
.doc-h{margin:7mm 0 5mm}
.doc-h .t1{font-size:17pt;font-weight:700;letter-spacing:-0.01em;line-height:1.2}
.doc-sub{color:${SOFT};font-size:10pt;margin-top:1mm}
.fine{font-size:8.2pt;color:${SOFT}}
.slip-ref{display:flex;align-items:center;justify-content:space-between;gap:4mm;padding:4.5mm 5mm;border:0.35mm solid ${INK};border-radius:2mm}
.lbl{font-size:7.4pt;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}}
.slip-ref .big{font-size:17pt;font-weight:700;margin-top:0.5mm}
.slip-ref .brk{font-size:7.4pt;color:${MUTED};margin-top:0.8mm}
.vpill{flex:none;padding:1.2mm 3.2mm;border-radius:999px;background:${INK};color:#fff;font-weight:600;font-size:8.6pt}
.skv{display:grid;grid-template-columns:44mm 1fr;margin:5mm 0}
.skv dt,.skv dd{margin:0;padding:1.8mm 0;border-bottom:0.25mm solid ${LINE}}
.skv dt{color:${MUTED}}
.skv dd{font-weight:500}
.late{display:inline-block;padding:0 1.6mm;margin-right:1.4mm;border-radius:0.8mm;background:#fdeceb;color:#b3241a;font-weight:700;font-size:8pt}
.vpanel{padding:5mm;border-radius:2mm;background:#f6f5f3;margin:5mm 0 4mm}
.vpanel .t{font-size:11pt;font-weight:700;margin-bottom:1.5mm}
.vpanel .vcode{font-size:12pt;font-weight:700;letter-spacing:0.03em;margin:1.5mm 0 2mm}
.signed{display:flex;justify-content:flex-end}`;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** `DCB biennial declaration · PSC issuer · 2027 declaration year · 0000001 sequence · K check`. */
function breakdown(type: DeclarationType, reference: string): string {
  const scheme = declarationSchemes[type];
  const [code, issuer, year, sequence, check] = reference.split('-');
  return `${code} ${scheme.name.toLowerCase()} · ${issuer} issuer · ${year} ${scheme.periodName?.toLowerCase()} · ${sequence} sequence · ${check} check`;
}

/**
 * The acknowledgement slip (First Schedule note 11): proof that a declaration version was
 * received, restricted (the verify page shows reference, type, Commission and date only).
 */
export const acknowledgementSlipV1: DocumentTemplate<AcknowledgementSlipPayload> = {
  type: ACKNOWLEDGEMENT_SLIP,
  version: 1,
  disclosureLevel: 'restricted',
  title: 'Acknowledgement slip',
  payload: acknowledgementSlipPayload,

  reference(payload) {
    return payload.reference;
  },

  subjectVersion(payload) {
    return payload.version;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: ACKNOWLEDGEMENT_SLIP,
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
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const scheme = declarationSchemes[payload.declarationType];
    const due = payload.dueDate ? `${esc(formatDate(payload.dueDate))}. ` : '';
    const dueDate = payload.late
      ? `<span class="late">LATE</span>${due}Submitted after the due date`
      : `${due}Submitted on time`;
    const replaces =
      payload.version > 1
        ? `<dt>Replaces</dt><dd>Version ${payload.version - 1} (superseded)</dd>`
        : '';
    const body = `${letterhead({ name: payload.commissionName, code: payload.issuerCode })}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Acknowledgement slip</div><div class="doc-sub">Declaration of income, assets and liabilities</div></div>
<div class="slip-ref"><div><div class="lbl">Reference number</div><div class="big mono nw">${esc(payload.reference)}</div><div class="brk">${esc(breakdown(payload.declarationType, payload.reference))}</div></div><div class="vpill">Version ${payload.version}</div></div>
<dl class="skv">
<dt>Declarant</dt><dd>${esc(payload.declarantName)}</dd>
<dt>Responsible Commission</dt><dd>${esc(payload.commissionName)} (${esc(payload.issuerCode)})</dd>
<dt>Declaration</dt><dd>${scheme.name}</dd>
<dt>Statement date</dt><dd>${esc(formatDate(payload.statementDate))}</dd>
<dt>Submitted</dt><dd>${esc(formatDateTime(payload.submittedAt))}</dd>
<dt>Due date</dt><dd>${dueDate}</dd>
<dt>Contents</dt><dd>${plural(payload.statementCount, 'statement', 'statements')}, ${plural(payload.itemCount, 'item', 'items')}</dd>
${replaces}
</dl>
<p class="fine">This slip confirms that the declaration was received through Adili Online. It is not a finding that the declaration is complete or correct.</p>
<p class="fine">Filed electronically: valid without a signature, stamp or paper slip (First Schedule, note 12).</p>
<div class="vpanel"><div class="t">Check that this slip is genuine</div><div>Scan the QR code at the foot of the page, or go to the Adili Online verify page and enter:</div><div class="vcode mono nw">${esc(verificationId)}</div><div class="fine">The check shows only the reference, type, Commission and date.</div></div>
<div class="signed">${signatureNote(signerName, issuedAt)}</div>`;
    return htmlDocument(`Acknowledgement slip ${payload.reference}`, STYLES, body);
  },
};
