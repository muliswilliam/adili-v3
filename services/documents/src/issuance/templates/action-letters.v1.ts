import { ADM, CLR, declarationSchemes } from '@adili/numbering/references';
import {
  DISCIPLINARY_REFERRAL,
  type DocumentType,
  NOTICE_TO_COMPLY,
  SALARY_STOPPAGE,
  WARNING,
} from '@adili/events/contracts';
import { z } from 'zod';

import {
  bigDate,
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
import { DECLARATION_TYPES, isReferenceOf, numberedBy, referenceOf } from './references.js';
import type { DocumentTemplate } from './template.js';

/** The steps of the administrative action ladder, each issued as its own letter type. */
const STEPS = ['notice-to-comply', 'warning', 'salary-stoppage', 'disciplinary-referral'] as const;
type Step = (typeof STEPS)[number];

/**
 * What the review service's action letter payload endpoint returns
 * (`internalGetActionLetterPayload`, review.yaml `ActionLetterPayload`) less the declarant's person
 * id, which issuance checks and the letter does not print. The documents service pulls it by
 * action id when it issues the step's letter; one payload serves the four step letters.
 */
export const actionLetterPayload = z
  .object({
    declarantName: z.string().trim().min(1).max(200),
    personnelFileNumber: z.string().trim().min(1).max(50),
    commission: letterCommissionSchema,
    /** The step's `ADM` reference number. */
    reference: referenceOf(ADM),
    step: z.enum(STEPS),
    /** How the console and portal name the step, e.g. `Notice to comply`. */
    stepLabel: z.string().trim().min(1).max(100),
    /** What the declarant failed to do: file a declaration, or answer a clarification. */
    subjectKind: z.enum(['obligation', 'clarification']),
    /** The obligation's cycle key (`biennial:2027`, `initial:2027-03-10`) or the `CLR` reference. */
    subjectReference: z.string().trim().min(1).max(100),
    whatToDo: z.enum(['file-declaration', 'respond-to-clarification']),
    issuedAt: z.iso.datetime({ offset: true }),
    /** By when to act; null for the disciplinary referral, which sets no deadline. */
    actBy: z.iso.datetime({ offset: true }).nullable(),
    /** The salary stoppage's effective date; null for the other steps. */
    salaryStoppedFrom: z.iso.date().nullable(),
    /** The notice on the portal, where the declarant responds. */
    respondUrl: portalUrlSchema,
  })
  .refine((payload) => numberedBy(payload.reference, ADM, payload.commission.issuerCode), {
    message: "The ADM reference number is not the Commission's",
    path: ['reference'],
  })
  .refine(
    (payload) =>
      payload.subjectKind === 'obligation'
        ? payload.whatToDo === 'file-declaration' && cycleOf(payload.subjectReference) !== null
        : payload.whatToDo === 'respond-to-clarification' &&
          isReferenceOf(payload.subjectReference, [CLR]),
    {
      message:
        "Must be an obligation's cycle key with file-declaration, or a CLR reference with respond-to-clarification",
      path: ['subjectReference'],
    },
  )
  .refine((payload) => (payload.actBy === null) === (payload.step === 'disciplinary-referral'), {
    message: 'Every step but the disciplinary referral says by when to act',
    path: ['actBy'],
  })
  .refine(
    (payload) => (payload.salaryStoppedFrom === null) === (payload.step !== 'salary-stoppage'),
    {
      message: 'Only the salary stoppage says from when the salary is stopped',
      path: ['salaryStoppedFrom'],
    },
  )
  .meta({
    description:
      "Payload of notice-to-comply, warning, salary-stoppage and disciplinary-referral v1: the review service's action letter payload, pulled by action id",
  });

export type ActionLetterPayload = z.infer<typeof actionLetterPayload>;

/** `biennial:2027` as the biennial declaration and its year; null for anything else. */
function cycleOf(cycleKey: string): { name: string; period: string } | null {
  const [type, period, ...rest] = cycleKey.split(':');
  if (rest.length > 0 || !period) return null;
  const known = DECLARATION_TYPES.find((each) => each === type);
  if (!known) return null;
  const name = declarationSchemes[known].name.toLowerCase();
  if (/^\d{4}$/.test(period)) return { name, period: `for ${period}` };
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return { name, period: `as at ${formatDate(period)}` };
  return null;
}

/**
 * What the declarant did not do: as a noun phrase (`what`), a subject line's tail, what to do,
 * and the "Regarding" reference (HTML).
 */
interface Failure {
  what: string;
  subject: string;
  act: string;
  regarding: string;
}

function failure(payload: ActionLetterPayload): Failure {
  if (payload.subjectKind === 'clarification') {
    return {
      what: `the request for clarification ${payload.subjectReference}`,
      subject: `clarification ${payload.subjectReference} not answered`,
      act: `Respond to clarification ${payload.subjectReference} on Adili Online.`,
      regarding: `<span class="mono nw">${esc(payload.subjectReference)}</span>`,
    };
  }
  const cycle = cycleOf(payload.subjectReference);
  if (!cycle) throw new Error(`${payload.subjectReference} is not a cycle key`);
  const declaration = `${cycle.name} ${cycle.period}`;
  return {
    what: `your ${declaration}`,
    subject: `${declaration} not filed`,
    act: `File your ${declaration} on Adili Online.`,
    regarding: esc(declaration.charAt(0).toUpperCase() + declaration.slice(1)),
  };
}

const REQUIRED_BY_LAW =
  'Failing to submit a declaration or information the Conflict of Interest Act, 2025 requires within the prescribed period is an offence under section 38.';

/** How to respond on the portal, for every step. */
function howToRespond(payload: ActionLetterPayload): string {
  return `Sign in at ${portalLink(payload.respondUrl)}, open Notices and select <b class="nw">${esc(payload.reference)}</b>. You may explain your circumstances and attach documents (PDF, JPEG, PNG or HEIC, up to 20&nbsp;MB each). Your response is recorded for the Commission but does not by itself stop this action.`;
}

const BAN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>`;

/**
 * What each step's letter says: the earlier steps the declarant did not act on, a banner, and the
 * rows after "What happened" (values are HTML; `act` is what to do, escaped).
 */
const STEP_COPY: Record<
  Step,
  {
    ignored: string | null;
    banner: string;
    rows(payload: ActionLetterPayload, act: string): [string, string][];
  }
> = {
  'notice-to-comply': {
    ignored: null,
    banner: '',
    rows: (payload, act) => [
      ['What you must do', act],
      ['By when', bigDate(payload.actBy ?? '')],
      ['If you do not act', `The Commission may issue a warning. ${REQUIRED_BY_LAW}`],
      ['How to respond', howToRespond(payload)],
    ],
  },
  warning: {
    ignored: "the Commission's notice to comply",
    banner: '',
    rows: (payload, act) => [
      ['What you must do', act],
      ['By when', bigDate(payload.actBy ?? '')],
      ['If you do not act', 'The Commission may stop your salary until you comply.'],
      ['How to respond', howToRespond(payload)],
    ],
  },
  'salary-stoppage': {
    ignored: "the Commission's notice to comply or its warning",
    banner: `<div class="banner danger">${BAN}<div>Your salary has been stopped pending compliance. It will be reinstated automatically when you comply.</div></div>`,
    rows: (payload, act) => [
      ['Salary stopped from', bigDate(payload.salaryStoppedFrom ?? '')],
      ['What you must do', `${act} Your salary is reinstated automatically once you do.`],
      [
        'If you do not act',
        `If you have not complied by ${esc(formatDate(payload.actBy ?? ''))}, the Commission may refer you to your employer for disciplinary proceedings.`,
      ],
      ['How to respond', howToRespond(payload)],
    ],
  },
  'disciplinary-referral': {
    ignored: "the Commission's notice to comply, its warning or the stoppage of your salary",
    banner: '',
    rows: (payload, act) => [
      [
        'Decision',
        'The Commission has referred you to your employer for disciplinary proceedings. Your employer runs that process and will contact you.',
      ],
      ['Your salary', 'Remains stopped until you comply.'],
      ['What you must do', `${act} Complying reinstates your salary automatically.`],
      ['How to respond', howToRespond(payload)],
    ],
  },
};

/** What happened: the failure, after the earlier steps the declarant did not act on. */
function whatHappened(payload: ActionLetterPayload, what: string): string {
  const notDone =
    payload.subjectKind === 'clarification'
      ? `You have not responded to ${what} within the time section 35(3) of the Conflict of Interest Act, 2025 allows.`
      : `You have not filed ${what}, which the Conflict of Interest Act, 2025 requires.`;
  const ignored = STEP_COPY[payload.step].ignored;
  return ignored ? `You did not act on ${ignored}. ${notDone}` : notDone;
}

function render(
  payload: ActionLetterPayload,
  { verificationId, issuedAt, signerName }: Parameters<DocumentTemplate['render']>[1],
): string {
  const { what, subject, act, regarding } = failure(payload);
  const copy = STEP_COPY[payload.step];
  const body = `${letterhead({ name: payload.commission.name, code: payload.commission.issuerCode })}
${letterMeta(
  `<b>${esc(payload.declarantName)}</b><br />Personnel file ${esc(payload.personnelFileNumber)}`,
  [
    ['Ref', `<span class="mono nw">${esc(payload.reference)}</span>`],
    ['Date', `<span class="nw">${esc(formatDate(payload.issuedAt))}</span>`],
    ['Regarding', regarding],
  ],
)}
${subjectLine(`${payload.stepLabel}: ${subject}`)}
<p>Dear ${esc(payload.declarantName)},</p>
${copy.banner}
${facts([['What happened', esc(whatHappened(payload, what))], ...copy.rows(payload, esc(act))])}
<section class="close">
${restrictedVerifyNote(verificationId)}
${letterClose(payload.commission.name, signerName, issuedAt)}
</section>`;
  return htmlDocument(`${payload.stepLabel} ${payload.reference}`, LETTER_STYLES, body);
}

/**
 * The letter of one step of the administrative action ladder (spec 08, Administrative
 * Mechanisms): what the declarant failed to do, what to do and by when, what follows if they do
 * not, and how to respond on the portal. Restricted: the verify page shows reference, type,
 * Commission and date only. The pulled payload must be of the template's own step.
 */
function actionLetter(
  type: DocumentType & Step,
  title: string,
): DocumentTemplate<ActionLetterPayload> {
  return {
    type,
    version: 1,
    disclosureLevel: 'restricted',
    title,
    payload: actionLetterPayload.refine((payload) => payload.step === type, {
      message: `Must be the ${type} step`,
      path: ['step'],
    }),

    links(payload) {
      return { respondUrl: payload.respondUrl };
    },

    reference(payload) {
      return payload.reference;
    },

    subjectVersion() {
      return null;
    },

    publicPayload(payload, { issuedAt }) {
      return {
        type,
        issuerName: payload.commission.name,
        issuerCode: payload.commission.issuerCode,
        issuedAt: issuedAt.toISOString(),
        reference: payload.reference,
        version: null,
      };
    },

    footer(payload) {
      return {
        issuerName: payload.commission.name,
        reference: payload.reference,
        version: null,
        mark: 'RESTRICTED',
      };
    },

    render,
  };
}

export const noticeToComplyV1 = actionLetter(NOTICE_TO_COMPLY, 'Notice to comply');
export const warningV1 = actionLetter(WARNING, 'Warning');
export const salaryStoppageV1 = actionLetter(SALARY_STOPPAGE, 'Salary stoppage');
export const disciplinaryReferralV1 = actionLetter(DISCIPLINARY_REFERRAL, 'Disciplinary referral');
