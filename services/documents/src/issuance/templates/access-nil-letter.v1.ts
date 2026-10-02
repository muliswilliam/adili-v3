import { ACCESS_NIL_LETTER } from '@adili/events/contracts';
import { z } from 'zod';

import {
  grantedScopeSchema,
  grantRecipientSchema,
  grantReferenceSchema,
  issuedTo,
  LEGAL_BASIS_TEXT,
  legalBasisSchema,
  scopeText,
} from './access-grant.js';
import {
  DECLARATION_DOCUMENT_STYLES,
  esc,
  formatDateTime,
  htmlDocument,
  INK,
  LETTERHEAD_STYLES,
  letterhead,
  signatureNote,
  verificationPanel,
} from './page.js';
import { commissionRefSchema } from './references.js';
import type { DocumentTemplate } from './template.js';

/**
 * What the access service hands over when a grant finds nothing to disclose: the grant (its
 * reference, legal basis, recipient, time and scope), the Commission and the declarant it is
 * about. No declaration content: there is none within the scope. Never stored beyond the PDF.
 */
export const accessNilLetterPayload = z
  .strictObject({
    grantReference: grantReferenceSchema,
    commission: commissionRefSchema,
    declarantName: z.string().trim().min(1).max(200).meta({
      description: 'The declarant the request is about, as the Commission identified them',
    }),
    legalBasis: legalBasisSchema,
    recipient: grantRecipientSchema,
    grantedAt: z.iso.datetime({ offset: true }),
    scope: grantedScopeSchema,
  })
  .meta({
    description:
      'Payload of access-nil-letter v1: a grant whose scope holds no declaration at the Commission, and whom the letter saying so is issued to',
  });

export type AccessNilLetterPayload = z.infer<typeof accessNilLetterPayload>;

const STYLES = `${LETTERHEAD_STYLES}${DECLARATION_DOCUMENT_STYLES}
.cpill{flex:none;padding:1.2mm 3.2mm;border-radius:999px;background:${INK};color:#fff;font-weight:700;font-size:8pt;letter-spacing:0.14em}
.nil-statement{padding:4.5mm 5mm;border-radius:2mm;border:0.35mm solid ${INK};margin:4mm 0;font-size:10pt;line-height:1.5}
.nil-statement .t{font-size:11pt;font-weight:700;margin-bottom:1.5mm}
.nil-statement p:last-child{margin-bottom:0}
.warn{padding:3.5mm 5mm;border-radius:2mm;background:#fdf3ec;border:0.3mm solid #f1c3a6;margin:4mm 0}
.warn .t{font-weight:700;margin-bottom:1mm}
.close{display:flex;align-items:flex-end;gap:4mm;margin:5mm 0 0;break-inside:avoid}
.close .vpanel{flex:1;margin:0}
.close .signed{flex:none}`;

/**
 * The nil letter (spec 10): a grant on an access request or a law-enforcement request whose
 * scope holds no declaration is answered with a signed letter saying so, in place of the access
 * package. Confidential like the package (the verify page shows validity only), watermarked with
 * its recipient on every page and downloadable by them for the same window.
 */
export const accessNilLetterV1: DocumentTemplate<AccessNilLetterPayload> = {
  type: ACCESS_NIL_LETTER,
  version: 1,
  disclosureLevel: 'confidential',
  title: 'Nil letter',
  requires: { watermark: true, downloadWindow: true, subjectPerson: true },
  payload: accessNilLetterPayload,

  reference(payload) {
    return payload.grantReference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload() {
    return null;
  },

  footer(payload) {
    return {
      issuerName: payload.commission.name,
      reference: payload.grantReference,
      version: null,
      mark: 'CONFIDENTIAL',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const { commission } = payload;
    const body = `${letterhead({ name: commission.name, code: commission.issuerCode })}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">No declarations held</div><div class="doc-sub">Nil letter on a granted request for declarations of income, assets and liabilities</div></div>
<div class="ref"><div><div class="lbl">Request reference</div><div class="big mono nw">${esc(payload.grantReference)}</div></div><div class="cpill">CONFIDENTIAL</div></div>
<dl class="skv">
<dt>Issued to</dt><dd>${esc(issuedTo(payload.recipient))}</dd>
<dt>Declarant</dt><dd>${esc(payload.declarantName)}</dd>
<dt>Responsible Commission</dt><dd>${esc(commission.name)} (${esc(commission.issuerCode)})</dd>
<dt>Legal basis</dt><dd>${esc(LEGAL_BASIS_TEXT[payload.legalBasis])}</dd>
<dt>Granted</dt><dd>${esc(formatDateTime(payload.grantedAt))}</dd>
<dt>Scope granted</dt><dd>${scopeText(payload.scope).map(esc).join('<br />')}</dd>
</dl>
<div class="nil-statement"><div class="t">No declarations held within the granted scope</div><p>The ${esc(commission.name)} granted the request above. It holds no declaration of income, assets and liabilities by ${esc(payload.declarantName)} within the scope granted, so there is nothing to disclose.</p><p>This letter is issued in place of an access package. It discloses no content of any declaration.</p></div>
<div class="warn"><div class="t">For the recipient named above only</div><div>Every page carries the recipient's name, the request reference and the date of issue.</div></div>
<div class="close">${verificationPanel('letter', verificationId, 'The check shows only whether the letter is valid, never its contents or who it was issued to.')}<div class="signed">${signatureNote(signerName, issuedAt)}</div></div>`;
    return htmlDocument(`Nil letter ${payload.grantReference}`, STYLES, body);
  },
};
