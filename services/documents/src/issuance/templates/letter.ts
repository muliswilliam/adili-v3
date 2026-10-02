import { z } from 'zod';

import {
  esc,
  formatDate,
  INK,
  LETTERHEAD_STYLES,
  LINE,
  MUTED,
  SOFT,
  signatureNote,
} from './page.js';

/**
 * Parts of the Commission's letters to a declarant (spec 08: the decision letter and the
 * administrative action ladder's letters), after the documents prototype: the address and
 * reference block, the subject line, fact tables, banners and the closing with the signature
 * note.
 */

const ISSUER_CODE = /^[A-Z0-9]{2,20}$/;

/** The issuing Commission as the review service names it in a letter payload. */
export const letterCommissionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** The Commission's issuer code, as in the reference numbers (`PSC`). */
  issuerCode: z.string().regex(ISSUER_CODE),
});

/** A portal link printed in a letter (http in development, https otherwise). */
export const portalUrlSchema = z.url({ protocol: /^https?$/ }).max(500);

export const LETTER_STYLES = `${LETTERHEAD_STYLES}
body{font-size:9.6pt;line-height:1.5}
p{margin:0 0 3mm}
a{color:inherit}
h2{font-size:9.8pt;font-weight:700;margin:4mm 0 1.5mm;break-after:avoid}
.meta{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;margin:6mm 0}
.meta address{font-style:normal;line-height:1.5}
.refs{display:grid;grid-template-columns:auto auto;gap:0.8mm 4mm;margin:0;font-size:9pt}
.refs dt{color:${MUTED}}
.refs dd{margin:0;font-weight:500}
.subj{font-weight:700;text-transform:uppercase;letter-spacing:0.02em;text-decoration:underline;text-underline-offset:1.2mm;text-decoration-thickness:0.3mm;margin:0 0 4mm;font-size:9.8pt;line-height:1.45}
.facts{width:100%;border-collapse:collapse;margin:1mm 0 5mm}
.facts th,.facts td{text-align:left;vertical-align:top;padding:2.4mm 0;border-top:0.25mm solid ${LINE}}
.facts tr{break-inside:avoid}
.facts tr:last-child th,.facts tr:last-child td{border-bottom:0.25mm solid ${LINE}}
.facts th{width:38mm;padding-right:4mm;font-weight:600;color:${SOFT}}
.facts td p:last-child{margin:0}
.big-date{font-size:12pt;font-weight:700}
.banner{display:flex;gap:3mm;align-items:center;padding:3mm 4mm;border-radius:1.6mm;margin:0 0 5mm;font-weight:600;break-inside:avoid}
.banner svg{flex:none}
.banner.danger{background:#fdeceb;color:#8a1c14}
.prose{white-space:pre-line;overflow-wrap:anywhere}
.fine{font-size:8.2pt;color:${SOFT}}
.sign{display:flex;justify-content:space-between;align-items:flex-end;gap:6mm;margin-top:7mm;break-inside:avoid}
.sign .nm{font-weight:700;margin-top:2mm}
.ink{color:${INK}}`;

/** The addressee on the left, the references on the right. */
export function letterMeta(addressee: string, rows: readonly [string, string][]): string {
  const refs = rows.map(([term, value]) => `<dt>${esc(term)}</dt><dd>${value}</dd>`).join('');
  return `<div class="meta"><address>${addressee}</address><dl class="refs">${refs}</dl></div>`;
}

/** The subject line, set in capitals; the document's heading. */
export function subjectLine(text: string): string {
  return `<div class="subj" role="heading" aria-level="1">${esc(text)}</div>`;
}

/** A table of what the letter says, one row per heading; values are HTML. */
export function facts(rows: readonly [string, string][]): string {
  const body = rows
    .map(([heading, value]) => `<tr><th scope="row">${esc(heading)}</th><td>${value}</td></tr>`)
    .join('');
  return `<table class="facts"><tbody>${body}</tbody></table>`;
}

/** `30 Sep 2026` set large: the date the declarant must act by. */
export function bigDate(value: string): string {
  return `<span class="big-date">${esc(formatDate(value))}</span>`;
}

/** The portal link as its host, e.g. `adili.go.ke`, linked to the page itself. */
export function portalLink(url: string): string {
  return `<a href="${esc(url)}"><b>${esc(new URL(url).host)}</b></a>`;
}

/** How to check the letter, and what the check shows of a Restricted letter. */
export function restrictedVerifyNote(verificationId: string): string {
  return `<p class="fine">Check that this letter is genuine: scan the QR code at the foot of any page, or enter <span class="mono nw">${esc(verificationId)}</span> on the Adili Online verify page. The check shows only the reference, type, Commission and date.</p>`;
}

/** The closing: the Commission's name and the note of the digital signature. */
export function letterClose(commissionName: string, signerName: string, issuedAt: Date): string {
  return `<div class="sign"><div><div>Yours faithfully,</div><div class="nm">${esc(commissionName)}</div></div>${signatureNote(signerName, issuedAt)}</div>`;
}
