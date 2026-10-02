import { CLR } from '@adili/numbering/references';
import { CLARIFICATION_LETTER } from '@adili/events/contracts';
import { z } from 'zod';

import {
  LETTER_STYLES,
  letterClose,
  letterCommissionSchema,
  letterMeta,
  portalLink,
  portalUrlSchema,
  restrictedVerifyNote,
  subjectLine,
} from './letter.js';
import { esc, formatDate, htmlDocument, INK, letterhead, LINE } from './page.js';
import {
  declarationSchemeOf,
  isDeclarationReference,
  numberedBy,
  referenceOf,
} from './references.js';
import type { DocumentTemplate } from './template.js';

/**
 * What the review service's clarification letter payload endpoint returns
 * (`internalGetClarificationLetterPayload`, review.yaml `ClarificationLetterPayload`): only what
 * the letter prints. The documents service pulls it by clarification id when it issues the
 * letter, so no personal data travels in the issue request.
 */
export const clarificationLetterPayload = z
  .object({
    declarantName: z.string().trim().min(1).max(200),
    commission: letterCommissionSchema,
    declarationReference: z.string().refine(isDeclarationReference, {
      message: 'Must be a declaration reference number with a valid check character',
    }),
    clarificationReference: referenceOf(CLR),
    items: z
      .array(
        z.object({
          /** What the item concerns, e.g. `Assets · Plot KSM/123 · Grace Otieno`. */
          label: z.string().trim().min(1).max(500),
          /** What Act s.35(4) requires, e.g. `Explain the discrepancy or inconsistency`. */
          requirementLabel: z.string().trim().min(1).max(200),
          text: z.string().trim().min(1).max(1000),
        }),
      )
      .min(1)
      .max(50),
    issuedAt: z.iso.datetime({ offset: true }),
    dueAt: z.iso.datetime({ offset: true }),
    /** The portal page where the declarant answers this clarification. */
    portalUrl: portalUrlSchema,
  })
  .refine(
    (payload) => numberedBy(payload.clarificationReference, CLR, payload.commission.issuerCode),
    {
      message: "The CLR reference number is not the Commission's",
      path: ['clarificationReference'],
    },
  )
  .refine((payload) => Date.parse(payload.dueAt) > Date.parse(payload.issuedAt), {
    message: 'The due date must be after the date of issue',
    path: ['dueAt'],
  });

export type ClarificationLetterPayload = z.infer<typeof clarificationLetterPayload>;

const STYLES = `${LETTER_STYLES}
h2{margin:0 0 2mm}
.close{break-inside:avoid;padding-top:1mm}
.items{list-style:none;padding:0;margin:2mm 0 0}
.items li{display:flex;gap:2.5mm;padding:3mm 4mm 3mm 3mm;margin-bottom:2.5mm;border:0.25mm solid ${LINE};border-radius:1.6mm;break-inside:avoid}
.items .n{flex:none;width:6mm;height:6mm;margin-top:-0.2mm;border-radius:50%;background:${INK};color:#fff;display:flex;align-items:center;justify-content:center;font-size:7.6pt;font-weight:700}
.items .body{flex:1;min-width:0}
.items .it{font-weight:600;overflow-wrap:anywhere}
.items .req{display:inline-block;margin:1mm 0 1.5mm;padding:0.4mm 2mm;border-radius:1mm;background:#fdf0e9;color:#8a3a10;font-size:8pt;font-weight:600}
.items p{margin:0;white-space:pre-line;overflow-wrap:anywhere}
.banner{margin:2mm 0 5mm;background:#fdf4e2;color:#6e4000}
.banner .s{display:block;font-weight:400;font-size:8.6pt}
.steps{margin:0 0 4mm;padding-left:5mm}
.steps li{margin-bottom:1.2mm;padding-left:1mm}`;

const CALENDAR = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`;

/** `the item below`, `the 3 items below`. */
function itemsBelow(count: number): string {
  return count === 1 ? 'the item below' : `the ${count} items below`;
}

/**
 * The clarification letter (Act s.35, spec 07a): the Commission's request that the declarant
 * clarify items of a declaration, with what each requires, the due date and how to respond in
 * the portal. Restricted: the verify page shows reference, type, Commission and date only.
 */
export const clarificationLetterV1: DocumentTemplate<ClarificationLetterPayload> = {
  type: CLARIFICATION_LETTER,
  version: 1,
  disclosureLevel: 'restricted',
  title: 'Clarification letter',
  payload: clarificationLetterPayload,

  links(payload) {
    return { portalUrl: payload.portalUrl };
  },

  reference(payload) {
    return payload.clarificationReference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: CLARIFICATION_LETTER,
      issuerName: payload.commission.name,
      issuerCode: payload.commission.issuerCode,
      issuedAt: issuedAt.toISOString(),
      reference: payload.clarificationReference,
      version: null,
    };
  },

  footer(payload) {
    return {
      issuerName: payload.commission.name,
      reference: payload.clarificationReference,
      version: null,
      mark: 'RESTRICTED',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const declaration = declarationSchemeOf(payload.declarationReference).name.toLowerCase();
    const due = esc(formatDate(payload.dueAt));
    // The reply window is the Commission's policy (30 days by default): the letter says the one
    // its due date was set with, not a fixed number.
    const replyDays = Math.round(
      (Date.parse(payload.dueAt) - Date.parse(payload.issuedAt)) / 86_400_000,
    );
    const reference = esc(payload.clarificationReference);
    const items = payload.items
      .map(
        (item, index) =>
          `<li><span class="n" aria-hidden="true">${index + 1}</span><div class="body"><div class="it">${esc(item.label)}</div><span class="req">What we need: ${esc(item.requirementLabel)}</span><p>${esc(item.text)}</p></div></li>`,
      )
      .join('');
    const body = `${letterhead({ name: payload.commission.name, code: payload.commission.issuerCode })}
${letterMeta(`<b>${esc(payload.declarantName)}</b>`, [
  ['Ref', `<span class="mono nw">${reference}</span>`],
  ['Date', `<span class="nw">${esc(formatDate(payload.issuedAt))}</span>`],
  ['Declaration', `<span class="mono nw">${esc(payload.declarationReference)}</span>`],
])}
${subjectLine(`Request for clarification: ${declaration} ${payload.declarationReference}`)}
<p>Dear ${esc(payload.declarantName)},</p>
<p>Under section 35(2) of the Conflict of Interest Act, 2025, the Commission has reviewed your ${declaration} ${esc(payload.declarationReference)}. Please clarify ${itemsBelow(payload.items.length)}.</p>
<ol class="items">${items}</ol>
<div class="banner">${CALENDAR}<div>Respond by ${due}<span class="s">You have ${replyDays} day${replyDays === 1 ? '' : 's'} from receipt of this letter to respond (section 35(3)).</span></div></div>
<section class="close">
<h2>How to respond</h2>
<ol class="steps">
<li>Sign in to Adili Online at ${portalLink(payload.portalUrl)}.</li>
<li>Open Clarifications and select <b class="nw">${reference}</b>.</li>
<li>Answer each item. Attach supporting documents if you have them (PDF, JPEG, PNG or HEIC, up to 20&nbsp;MB each).</li>
<li>Submit your response. You can respond once, so answer every item.</li>
</ol>
<p>A response after ${due} is still accepted and is recorded as late.</p>
${restrictedVerifyNote(verificationId)}
${letterClose(payload.commission.name, signerName, issuedAt)}
</section>`;
    return htmlDocument(
      `Request for clarification ${payload.clarificationReference}`,
      STYLES,
      body,
    );
  },
};
