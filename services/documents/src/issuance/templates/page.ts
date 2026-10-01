import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import QRCode from 'qrcode';

/**
 * Shared parts of every issued document's HTML (ADR-010): the typeface, the letterhead and the
 * verification footer Gotenberg repeats on every page. Values follow the documents prototype
 * (`services/documents/prototype`) and the `packages/ui` tokens.
 */

const require = createRequire(import.meta.url);

/** Inter (the design system's typeface), inlined: Chromium's footer loads no external files. */
const INTER = readFileSync(
  require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
).toString('base64');

const FONT_FACE = `@font-face{font-family:'Inter Variable';font-style:normal;font-display:block;font-weight:100 900;src:url(data:font/woff2;base64,${INTER}) format('woff2-variations');}`;

export const INK = '#1a1a1a';
export const MUTED = '#6f6e6b';
export const SOFT = '#4a4a48';
export const LINE = '#e2e0dc';
export const ACCENT = '#e95a24';

const BASE = `${FONT_FACE}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Inter Variable','Noto Sans',sans-serif;color:${INK};-webkit-print-color-adjust:exact;print-color-adjust:exact;font-feature-settings:'cv11','ss01'}
.mono{font-family:'DejaVu Sans Mono','Liberation Mono',monospace;letter-spacing:0.01em}
.nw{white-space:nowrap}`;

/** HTML-escapes text for element content and attribute values. */
export function esc(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const TIME_ZONE = 'Africa/Nairobi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar parts of an instant in Kenyan time. */
function kenyanParts(date: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', number> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

/**
 * `30 Sep 2026` (the design's three-letter months, whatever the ICU version), in Kenyan time for
 * instants; calendar dates (`2026-09-30`) as they are.
 */
export function formatDate(value: string | Date): string {
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00+03:00`)
      : new Date(value);
  const { day, month, year } = kenyanParts(date);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `30 Sep 2026, 14:05 EAT`. */
export function formatDateTime(value: string | Date): string {
  const { hour, minute } = kenyanParts(new Date(value));
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${formatDate(value)}, ${pad(hour)}:${pad(minute)} EAT`;
}

export interface LetterheadIssuer {
  name: string;
  code: string;
}

/** Republic of Kenya letterhead with the issuing Commission's seal and name. */
export function letterhead(issuer: LetterheadIssuer): string {
  return `<header class="lh"><div class="seal" aria-hidden="true"><span>${esc(issuer.code)}</span></div><div><div class="rok">Republic of Kenya</div><div class="org">${esc(issuer.name)}</div><div class="addr">Issued through Adili Online</div></div></header>`;
}

/** Styles of the letterhead and the signature note, for a template's stylesheet. */
export const LETTERHEAD_STYLES = `
.lh{display:flex;align-items:center;gap:5mm;padding-bottom:4mm;border-bottom:0.45mm solid ${INK};position:relative}
.lh::after{content:'';position:absolute;left:0;bottom:-0.45mm;width:24mm;height:0.9mm;background:${ACCENT}}
.seal{width:17mm;height:17mm;flex:none;border-radius:50%;border:0.5mm solid ${INK};display:flex;align-items:center;justify-content:center;position:relative}
.seal::before{content:'';position:absolute;inset:1.2mm;border-radius:50%;border:0.25mm dashed #9a9894}
.seal span{font-weight:800;font-size:8pt;letter-spacing:0.03em}
.lh .rok{font-size:6.8pt;letter-spacing:0.22em;color:${MUTED};font-weight:600;text-transform:uppercase}
.lh .org{font-size:14pt;font-weight:700;line-height:1.2;margin:0.6mm 0 0.8mm}
.lh .addr{font-size:7.4pt;color:${SOFT};line-height:1.4}
.sigbox{display:flex;gap:2.5mm;align-items:flex-start;width:72mm;padding:2.5mm 3mm;border:0.3mm solid #9ccfaf;background:#f3faf5;border-radius:1.4mm;font-size:7.2pt;line-height:1.4;color:#1f3d2a}
.sigbox svg{flex:none;color:#167a3e;margin-top:0.3mm}
.sigbox b{font-size:7.6pt}`;

const SHIELD = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`;

/** The note that the PDF carries a digital signature; the signature itself is invisible. */
export function signatureNote(signerName: string, signedAt: Date): string {
  return `<div class="sigbox">${SHIELD}<div><b>Digitally signed by ${esc(signerName)}</b><br />${esc(formatDateTime(signedAt))}<br />PAdES · Reason: issued through Adili Online</div></div>`;
}

/** An HTML document for Gotenberg's main page. */
export function htmlDocument(title: string, styles: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${esc(title)}</title><style>${BASE}${styles}</style></head><body>${body}</body></html>`;
}

/** Who a watermarked document was issued to, for what and when (ADR-010 §6). */
export interface Watermark {
  recipientName: string;
  /** The request reference the document answers, e.g. `ARQ-PSC-2026-0000012-H`. */
  reference: string;
  /** Calendar date `YYYY-MM-DD`. */
  date: string;
}

/** `Issued to Amina Otieno · ARQ-PSC-2026-0000012-H · 1 Oct 2026`: the watermark's line. */
export function watermarkText(watermark: Watermark): string {
  return `Issued to ${watermark.recipientName} · ${watermark.reference} · ${formatDate(watermark.date)}`;
}

/** Lines of the watermark down each page; each fits the page's width whole. */
const WATERMARK_LINES = 5;

const WATERMARK_STYLES = `.wm{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:40mm 0}
.wm div{transform:rotate(-30deg);white-space:nowrap;font-size:11pt;font-weight:600;letter-spacing:0.03em;color:rgba(26,26,26,0.11)}`;

/**
 * `html` with the watermark across every page: a fixed layer above the content, which Chromium
 * prints on each page, so no page of a leaked copy lacks its recipient. Issuance applies it to
 * any template's document, so no template can forget it.
 */
export function watermarked(html: string, watermark: Watermark): string {
  const at = html.lastIndexOf('</body>');
  if (at < 0) throw new Error('a watermarked document needs a body');
  const line = `<div>${esc(watermarkText(watermark))}</div>`;
  const layer = `<style>${WATERMARK_STYLES}</style><div class="wm" aria-hidden="true">${line.repeat(WATERMARK_LINES)}</div>`;
  return `${html.slice(0, at)}${layer}${html.slice(at)}`;
}

/** What the verification footer shows on every page. */
export interface FooterFields {
  verificationId: string;
  /** The QR code's payload: the verify page of this document. */
  verifyUrl: string;
  issuerName: string;
  issuedAt: Date;
  reference: string | null;
  version: number | null;
  /** Disclosure mark printed on every page, e.g. `CONFIDENTIAL`; none for most documents. */
  mark?: string;
}

/**
 * The footer Gotenberg repeats on every page: QR code to the verify page, the verification code,
 * the issuer and issue date, the reference and version, and the page number. Chromium renders it
 * as a separate document, so fonts and the QR code are inline.
 */
export async function footerDocument(fields: FooterFields): Promise<string> {
  const qr = await QRCode.toString(fields.verifyUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: INK, light: '#ffffff' },
  });
  const host = new URL(fields.verifyUrl).host;
  const styles = `${BASE}
body{font-size:7pt;line-height:1.45;color:${SOFT};width:100%}
.pf{margin:0 18mm;padding-top:3.5mm;border-top:0.25mm solid ${LINE};display:flex;gap:4mm;align-items:center;width:calc(100% - 36mm)}
.pf-qr svg{display:block;width:17mm;height:17mm}
.pf-t{flex:1;min-width:0}
.pf b{color:${INK}}
.code{font-weight:700;color:${INK};font-size:7.4pt}
.pf-r{text-align:right;white-space:nowrap}
.pf-mark{font-weight:700;letter-spacing:0.24em;color:${INK};margin-bottom:0.6mm}`;
  const reference = fields.reference
    ? `<div>Ref <b class="nw">${esc(fields.reference)}</b></div>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><style>${styles}</style></head><body><footer class="pf"><div class="pf-qr">${qr}</div><div class="pf-t"><div><b>Check this document</b> at ${esc(host)} with code <span class="code mono nw">${esc(fields.verificationId)}</span></div><div>Issued by ${esc(fields.issuerName)} through Adili Online on ${esc(formatDate(fields.issuedAt))}</div>${reference}</div><div class="pf-r">${fields.mark ? `<div class="pf-mark">${esc(fields.mark)}</div>` : ''}${fields.version === null ? '' : `<div>Version ${esc(fields.version)}</div>`}<div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div></div></footer></body></html>`;
}
