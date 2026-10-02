import { CMP } from '@adili/numbering/references';
import { DECISION_LETTER } from '@adili/events/contracts';
import { z } from 'zod';

import {
  facts,
  LETTER_STYLES,
  letterClose,
  letterCommissionSchema,
  letterMeta,
  portalLink,
  portalUrlSchema,
  restrictedVerifyNote,
  subjectLine,
} from './letter.js';
import { esc, formatDate, htmlDocument, letterhead } from './page.js';
import {
  declarationSchemeOf,
  isDeclarationReference,
  numberedBy,
  referenceOf,
} from './references.js';
import type { DocumentTemplate } from './template.js';

/** review.yaml `DeterminationOutcome`. */
const OUTCOMES = ['compliant', 'compliant-no-issues', 'non-compliant', 'further-action'] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * What the review service's determination letter payload endpoint returns
 * (`internalGetDeterminationLetterPayload`, review.yaml `DeterminationLetterPayload`) less the
 * declarant's person id, which issuance checks and the letter does not print. The documents
 * service pulls it by determination id when it issues the letter.
 */
export const decisionLetterPayload = z
  .object({
    declarantName: z.string().trim().min(1).max(200),
    commission: letterCommissionSchema,
    declarationReference: z.string().refine(isDeclarationReference, {
      message: 'Must be a declaration reference number with a valid check character',
    }),
    determinationReference: referenceOf(CMP),
    outcome: z.enum(OUTCOMES),
    /** How the console and portal name the outcome, e.g. `Non-compliant`. */
    outcomeLabel: z.string().trim().min(1).max(100),
    reasons: z.string().trim().min(1).max(4000),
    /** When the determination was approved. */
    decidedAt: z.iso.datetime({ offset: true }),
    /** The decision on the portal. */
    portalUrl: portalUrlSchema,
  })
  .refine(
    (payload) => numberedBy(payload.determinationReference, CMP, payload.commission.issuerCode),
    {
      message: "The CMP reference number is not the Commission's",
      path: ['determinationReference'],
    },
  )
  .meta({
    description:
      "Payload of decision-letter v1: the review service's determination letter payload, pulled by determination id",
  });

export type DecisionLetterPayload = z.infer<typeof decisionLetterPayload>;

const STYLES = `${LETTER_STYLES}
.outcome{display:grid;grid-template-columns:auto 1fr;gap:1mm 5mm;align-items:center;padding:4mm 5mm;border-radius:2mm;margin:1mm 0 5mm;border:0.3mm solid;break-inside:avoid}
.outcome .ic{grid-row:span 2;width:10mm;height:10mm;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff}
.outcome .lbl{font-size:7.6pt;font-weight:600;letter-spacing:0.08em;text-transform:uppercase}
.outcome .v{font-size:14pt;font-weight:700;line-height:1.2}
.outcome.ok{border-color:#b9dfc6;background:#f3faf5}
.outcome.ok .ic{background:#167a3e}
.outcome.danger{border-color:#f1c2be;background:#fdf5f4}
.outcome.danger .ic{background:#c9291e}
.outcome.warn{border-color:#ecd3a3;background:#fefaf1}
.outcome.warn .ic{background:#9a5a00}`;

const icon = (path: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const CHECK = icon('<path d="M20 6 9 17l-5-5"/>');
const CROSS = icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
const ARROW = icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>');

/** How each determination is shown, and what the letter says follows from it. */
const OUTCOME_COPY: Record<
  Outcome,
  { tone: 'ok' | 'danger' | 'warn'; icon: string; body: (reasons: string) => string }
> = {
  compliant: {
    tone: 'ok',
    icon: CHECK,
    body: () =>
      '<p>Your declaration meets the requirements of the Conflict of Interest Act, 2025. You do not need to do anything.</p>',
  },
  // A bulk closure: its reasons say why the system proposed it, which is no finding to print.
  'compliant-no-issues': {
    tone: 'ok',
    icon: CHECK,
    body: () =>
      '<p>The Commission identified no issues with your declaration. You do not need to do anything.</p>',
  },
  'non-compliant': {
    tone: 'danger',
    icon: CROSS,
    body: (reasons) =>
      `<h2>Reasons</h2><p class="prose">${esc(reasons)}</p><h2>What happens next</h2><p>Your Commission may take administrative action. Any notice will appear under Notices on Adili Online, and you will get it by email and SMS.</p>`,
  },
  'further-action': {
    tone: 'warn',
    icon: ARROW,
    body: (reasons) =>
      `<h2>Reasons</h2><p class="prose">${esc(reasons)}</p><h2>What happens next</h2><p>The Commission has decided that your declaration needs further action. Your case stays open until that action is complete. If you need to do anything, the Commission will tell you by email and SMS, and it will appear under Notices on Adili Online.</p>`,
  },
};

/**
 * The decision letter (spec 08, Act s.35): the Commission's compliance determination on a
 * declaration, with its reasons where the outcome is not compliant. Issued when a supervisor
 * approves the determination, or on the declarant's first download for a bulk closure.
 * Restricted: the verify page shows reference, type, Commission and date only.
 */
export const decisionLetterV1: DocumentTemplate<DecisionLetterPayload> = {
  type: DECISION_LETTER,
  version: 1,
  disclosureLevel: 'restricted',
  title: 'Decision letter',
  payload: decisionLetterPayload,

  links(payload) {
    return { portalUrl: payload.portalUrl };
  },

  reference(payload) {
    return payload.determinationReference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: DECISION_LETTER,
      issuerName: payload.commission.name,
      issuerCode: payload.commission.issuerCode,
      issuedAt: issuedAt.toISOString(),
      reference: payload.determinationReference,
      version: null,
    };
  },

  footer(payload) {
    return {
      issuerName: payload.commission.name,
      reference: payload.determinationReference,
      version: null,
      mark: 'RESTRICTED',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const declaration = declarationSchemeOf(payload.declarationReference).name.toLowerCase();
    const reference = esc(payload.determinationReference);
    const copy = OUTCOME_COPY[payload.outcome];
    // A bulk closure's letter is produced when the declarant first asks for it: say both dates.
    const decided = formatDate(payload.decidedAt);
    const produced =
      decided === formatDate(issuedAt)
        ? ''
        : `<p class="fine">This letter was produced on request on ${esc(formatDate(issuedAt))}. The determination was recorded on ${esc(decided)}.</p>`;
    const body = `${letterhead({ name: payload.commission.name, code: payload.commission.issuerCode })}
${letterMeta(`<b>${esc(payload.declarantName)}</b>`, [
  ['Ref', `<span class="mono nw">${reference}</span>`],
  ['Date', `<span class="nw">${esc(formatDate(issuedAt))}</span>`],
  ['Declaration', `<span class="mono nw">${esc(payload.declarationReference)}</span>`],
])}
${subjectLine(`Compliance determination: ${declaration} ${payload.declarationReference}`)}
<p>Dear ${esc(payload.declarantName)},</p>
<p>The Commission has completed its review of your ${declaration} ${esc(payload.declarationReference)}.</p>
<div class="outcome ${copy.tone}"><span class="ic">${copy.icon}</span><div class="lbl">Determination</div><div class="v">${esc(payload.outcomeLabel)}</div></div>
${copy.body(payload.reasons)}
${facts([['On Adili Online', `Sign in at ${portalLink(payload.portalUrl)} and open Decisions to see this determination and download this letter again.`]])}
<section class="close">
<p>Keep this letter for your records. Anyone you share it with can check that it is genuine with the code at the foot of each page.</p>
${produced}
${restrictedVerifyNote(verificationId)}
${letterClose(payload.commission.name, signerName, issuedAt)}
</section>`;
    return htmlDocument(`Compliance determination ${payload.determinationReference}`, STYLES, body);
  },
};
