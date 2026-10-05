import { CLR } from '@adili/numbering/references';
import { CLARIFICATION_LETTER } from '@adili/events/contracts';
import { z } from 'zod';

import {
  LETTER_STYLES,
  letterClose,
  letterMeta,
  portalLink,
  portalUrlSchema,
  restrictedVerifyNote,
  subjectLine,
} from './letter.js';
import {
  esc,
  formatDate,
  htmlDocument,
  INK,
  LETTER_LANGUAGES,
  type LetterLanguage,
  letterhead,
  LINE,
} from './page.js';
import {
  declarationSchemeOf,
  isDeclarationReference,
  letterCommissionSchema,
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
          /** Drafted with AI (and possibly edited) before the reviewer issued it. */
          aiAssisted: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(50),
    issuedAt: z.iso.datetime({ offset: true }),
    dueAt: z.iso.datetime({ offset: true }),
    /** The portal page where the declarant answers this clarification. */
    portalUrl: portalUrlSchema,
    /**
     * The language the letter prints its own text in; item labels arrive in it already, the
     * opening and the items' text are the reviewer's. Letters from before it was sent: English.
     */
    language: z.enum(LETTER_LANGUAGES).default('en'),
    /** Printed before the items; null when the letter has none. */
    opening: z.string().trim().min(1).max(2000).nullable().default(null),
    /** Some of the text was drafted with AI and approved by the issuing reviewer (ADR-007). */
    aiAssisted: z.boolean().default(false),
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
/** The payload as review sends it: `language`, `opening` and `aiAssisted` may be missing. */
export type ClarificationLetterInput = z.input<typeof clarificationLetterPayload>;

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
.steps li{margin-bottom:1.2mm;padding-left:1mm}
.opening{white-space:pre-line;overflow-wrap:anywhere}
.ai{display:inline-block;padding:0.2mm 1.6mm;border-radius:0.8mm;background:#eef2fb;color:#23407a;font-size:7.6pt;font-weight:600;margin-left:1.5mm}
.ai-note{margin:3mm 0 0;font-size:8.6pt}`;

interface LetterCopy {
  /** The reference block's terms. */
  refs: { reference: string; date: string; declaration: string };
  subject: string;
  dear: string;
  intro: (declaration: string, reference: string, below: string) => string;
  below: (count: number) => string;
  need: string;
  aiItem: string;
  respondBy: string;
  window: (days: number) => string;
  how: string;
  steps: (portal: string, reference: string) => string[];
  late: (due: string) => string;
  aiNote: string;
}

/** The letter's own text in each language (#592); the Swahili awaits the Commission's review. */
const COPY: Record<LetterLanguage, LetterCopy> = {
  en: {
    refs: { reference: 'Ref', date: 'Date', declaration: 'Declaration' },
    subject: 'Request for clarification',
    dear: 'Dear',
    intro: (declaration, reference, below) =>
      `Under section 35(2) of the Conflict of Interest Act, 2025, the Commission has reviewed your ${declaration} ${reference}. Please clarify ${below}.`,
    below: (count) => (count === 1 ? 'the item below' : `the ${String(count)} items below`),
    need: 'What we need:',
    aiItem: 'AI-assisted draft',
    respondBy: 'Respond by',
    window: (days) =>
      `You have ${String(days)} day${days === 1 ? '' : 's'} from receipt of this letter to respond (section 35(3)).`,
    how: 'How to respond',
    steps: (portal, reference) => [
      `Sign in to Adili Online at ${portal}.`,
      `Open Clarifications and select <b class="nw">${reference}</b>.`,
      'Answer each item. Attach supporting documents if you have them (PDF, JPEG, PNG or HEIC, up to 20&nbsp;MB each).',
      'Submit your response. You can respond once, so answer every item.',
    ],
    late: (due) => `A response after ${due} is still accepted and is recorded as late.`,
    aiNote:
      'Parts of this letter were drafted with the help of AI and checked and approved by the Commission officer who issued it.',
  },
  sw: {
    refs: { reference: 'Kumb.', date: 'Tarehe', declaration: 'Tamko' },
    subject: 'Ombi la ufafanuzi',
    dear: 'Mpendwa',
    intro: (declaration, reference, below) =>
      `Kwa mujibu wa kifungu cha 35(2) cha Sheria ya Mgongano wa Maslahi, 2025, Tume imekagua ${declaration} yako ${reference}. Tafadhali toa ufafanuzi kuhusu ${below}.`,
    below: (count) =>
      count === 1
        ? 'kipengele kilicho hapa chini'
        : `vipengele ${String(count)} vilivyo hapa chini`,
    need: 'Tunachohitaji:',
    aiItem: 'Rasimu iliyosaidiwa na AI',
    respondBy: 'Jibu kufikia',
    window: (days) =>
      `Una siku ${String(days)} tangu kupokea barua hii kujibu (kifungu cha 35(3)).`,
    how: 'Jinsi ya kujibu',
    steps: (portal, reference) => [
      `Ingia kwenye Adili Online kupitia ${portal}.`,
      `Fungua Ufafanuzi kisha uchague <b class="nw">${reference}</b>.`,
      'Jibu kila kipengele. Ambatisha nyaraka za kuunga mkono ikiwa unazo (PDF, JPEG, PNG au HEIC, hadi MB&nbsp;20 kila moja).',
      'Wasilisha jibu lako. Unaweza kujibu mara moja tu, kwa hivyo jibu kila kipengele.',
    ],
    late: (due) => `Jibu baada ya ${due} bado linakubaliwa na hurekodiwa kuwa limechelewa.`,
    aiNote:
      'Sehemu za barua hii ziliandikwa kwa msaada wa AI na zikakaguliwa na kuidhinishwa na afisa wa Tume aliyeitoa.',
  },
};

/** Swahili names of the declaration types, e.g. `tamko la awali` for an initial declaration. */
const SW_DECLARATIONS: Record<string, string> = {
  initial: 'tamko la awali',
  biennial: 'tamko la kila miaka miwili',
  final: 'tamko la mwisho',
};

/** The declaration's name in the letter's language, e.g. `initial declaration`. */
function declarationName(reference: string, language: LetterLanguage): string {
  const name = declarationSchemeOf(reference).name.toLowerCase();
  if (language === 'en') return name;
  return SW_DECLARATIONS[name.replace(/ declaration$/, '')] ?? name;
}

const CALENDAR = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`;

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
      language: payload.language,
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const language = payload.language;
    const copy = COPY[language];
    const declaration = declarationName(payload.declarationReference, language);
    const due = esc(formatDate(payload.dueAt, language));
    // The reply window is the Commission's policy (30 days by default): the letter says the one
    // its due date was set with, not a fixed number.
    const replyDays = Math.round(
      (Date.parse(payload.dueAt) - Date.parse(payload.issuedAt)) / 86_400_000,
    );
    const reference = esc(payload.clarificationReference);
    const items = payload.items
      .map((item, index) => {
        const ai = item.aiAssisted ? `<span class="ai">${copy.aiItem}</span>` : '';
        return `<li><span class="n" aria-hidden="true">${String(index + 1)}</span><div class="body"><div class="it">${esc(item.label)}${ai}</div><span class="req">${copy.need} ${esc(item.requirementLabel)}</span><p>${esc(item.text)}</p></div></li>`;
      })
      .join('');
    const opening = payload.opening ? `<p class="opening">${esc(payload.opening)}</p>` : '';
    const steps = copy
      .steps(portalLink(payload.portalUrl), reference)
      .map((step) => `<li>${step}</li>`)
      .join('\n');
    const aiNote = payload.aiAssisted ? `<p class="ai-note">${copy.aiNote}</p>` : '';
    const body = `${letterhead({ name: payload.commission.name, code: payload.commission.issuerCode })}
${letterMeta(`<b>${esc(payload.declarantName)}</b>`, [
  [copy.refs.reference, `<span class="mono nw">${reference}</span>`],
  [copy.refs.date, `<span class="nw">${esc(formatDate(payload.issuedAt, language))}</span>`],
  [copy.refs.declaration, `<span class="mono nw">${esc(payload.declarationReference)}</span>`],
])}
${subjectLine(`${copy.subject}: ${declaration} ${payload.declarationReference}`)}
<p>${copy.dear} ${esc(payload.declarantName)},</p>
<p>${copy.intro(declaration, esc(payload.declarationReference), copy.below(payload.items.length))}</p>
${opening}
<ol class="items">${items}</ol>
<div class="banner">${CALENDAR}<div>${copy.respondBy} ${due}<span class="s">${copy.window(replyDays)}</span></div></div>
<section class="close">
<h2>${copy.how}</h2>
<ol class="steps">
${steps}
</ol>
<p>${copy.late(due)}</p>
${aiNote}
${restrictedVerifyNote(verificationId, 'letter', language)}
${letterClose(payload.commission.name, signerName, issuedAt, language)}
</section>`;
    return htmlDocument(
      `${copy.subject} ${payload.clarificationReference}`,
      STYLES,
      body,
      language,
    );
  },
};
