import { ADM, CMP } from '@adili/numbering/references';
import { z } from 'zod';

import {
  define,
  email,
  longDate,
  NEVER_ASKS,
  paragraph,
  portalUrlSchema,
  referenceOf,
  type RenderedEmail,
  signInParagraph,
} from './template-kit.js';

/**
 * Templates of compliance determinations and the administrative action ladder (spec 08), to the
 * declarant: a decision made, a notice to comply or warning issued, the salary stopped, the salary
 * reinstated. Their params are what the review service sends (its determination and
 * administrative action activities). They name the reference, the Commission and the
 * determination or dates only: the letter,
 * with what failed and the reasons, stays behind sign-in. The disciplinary referral has its
 * letter and the employer's event, and no message (spec 08).
 */

/** The Commission's name. The review service calls it `commission`. */
const commission = z.string().trim().min(1).max(120);
/** A civil date `YYYY-MM-DD` in Nairobi time, as the review service computes it. */
const civilDate = z.iso.date();

const determinationReference = referenceOf(
  [CMP],
  'a CMP determination reference such as CMP-PSC-2027-0000001-D',
);
const actionReference = referenceOf(
  [ADM],
  'an ADM administrative action reference such as ADM-PSC-2028-0000233-9',
);

/** How the console and portal name the outcomes (review's `OUTCOME_LABELS`). */
const OUTCOMES = [
  'Compliant',
  'Compliant: no issues identified',
  'Non-compliant',
  'Further action',
] as const;

/** The steps told by a notice; the salary stoppage has its own message, the referral none. */
const NOTICE_STEPS = ['Notice to comply', 'Warning'] as const;

const NOT_ATTACHED = 'It is not attached to this email, so that only you can open it.';
const QUESTIONS = `If you have questions, contact your Commission. ${NEVER_ASKS}`;

// ---- A determination was made ----

const decisionParams = z.strictObject({
  commission,
  reference: determinationReference,
  outcome: z.enum(OUTCOMES),
  portalUrl: portalUrlSchema,
});
type DecisionParams = z.infer<typeof decisionParams>;

function decisionEmail(params: DecisionParams): RenderedEmail {
  return email(`Decision on your declaration: ${params.reference}`, [
    paragraph(
      `${params.commission} has made its compliance determination on your declaration. The outcome is ${params.outcome}. Its reference number is ${params.reference}.`,
    ),
    ...(params.outcome === 'Non-compliant'
      ? [
          paragraph(
            'Your Commission may take administrative action. Check Notices on Adili Online.',
          ),
        ]
      : []),
    signInParagraph(
      params.portalUrl,
      `to read the decision and download its letter. ${NOT_ATTACHED}`,
    ),
    paragraph(QUESTIONS),
  ]);
}

// ---- A notice to comply or a warning was issued ----

const noticeParams = z.strictObject({
  commission,
  reference: actionReference,
  step: z.enum(NOTICE_STEPS),
  actBy: civilDate,
  portalUrl: portalUrlSchema,
});
type NoticeParams = z.infer<typeof noticeParams>;

function noticeEmail(params: NoticeParams): RenderedEmail {
  const step = params.step.toLowerCase();
  return email(`${params.step} ${params.reference}`, [
    paragraph(`${params.commission} has issued you a ${step}, reference ${params.reference}.`),
    paragraph(
      `Act by ${longDate(params.actBy)}. The ${step} says what you must do; if you do not, the Commission may take further action.`,
    ),
    signInParagraph(params.portalUrl, `to read the ${step} and respond. ${NOT_ATTACHED}`),
    paragraph(QUESTIONS),
  ]);
}

// ---- The salary was stopped ----

const salaryStoppedParams = z.strictObject({
  commission,
  reference: actionReference,
  /** The day payroll stops the salary from. */
  stoppedFrom: civilDate,
  /** The end of the stoppage's window, after which the disciplinary referral may follow. */
  actBy: civilDate,
  portalUrl: portalUrlSchema,
});
type SalaryStoppedParams = z.infer<typeof salaryStoppedParams>;

function salaryStoppedEmail(params: SalaryStoppedParams): RenderedEmail {
  return email(`Your salary has been stopped: ${params.reference}`, [
    paragraph(
      `${params.commission} has instructed payroll to stop your salary from ${longDate(params.stoppedFrom)}, pending compliance (reference ${params.reference}). It will be reinstated automatically when you comply.`,
    ),
    paragraph(
      `If you have not complied by ${longDate(params.actBy)}, the Commission may refer you to your employer for disciplinary proceedings.`,
    ),
    signInParagraph(
      params.portalUrl,
      `to read the letter, see what you must do and respond. ${NOT_ATTACHED}`,
    ),
    paragraph(QUESTIONS),
  ]);
}

// ---- The salary was reinstated ----

const salaryReinstatedParams = z.strictObject({
  commission,
  /** The salary stoppage's reference. */
  reference: actionReference,
  /** The day the reinstatement was sent to payroll. */
  reinstatedOn: civilDate,
  portalUrl: portalUrlSchema,
});
type SalaryReinstatedParams = z.infer<typeof salaryReinstatedParams>;

function salaryReinstatedEmail(params: SalaryReinstatedParams): RenderedEmail {
  return email(`Your salary has been reinstated: ${params.reference}`, [
    paragraph(
      `${params.commission} sent your salary reinstatement to payroll on ${longDate(params.reinstatedOn)}. It ends the salary stoppage ${params.reference}.`,
    ),
    paragraph('Your payroll applies it; ask your employer if your next payslip does not show it.'),
    signInParagraph(params.portalUrl, 'to see your notices.'),
    paragraph(QUESTIONS),
  ]);
}

export const determinationTemplates = {
  'decision-email': define({
    channel: 'email',
    params: decisionParams,
    copy: { en: decisionEmail },
  }),
  'decision-sms': define({
    channel: 'sms',
    params: decisionParams,
    copy: {
      en: (params) => ({
        text: `Adili: ${params.commission} has decided on your declaration (${params.reference}). The outcome is ${params.outcome}. Read it at ${params.portalUrl}`,
      }),
    },
  }),
  'notice-email': define({
    channel: 'email',
    params: noticeParams,
    copy: { en: noticeEmail },
  }),
  'notice-sms': define({
    channel: 'sms',
    params: noticeParams,
    copy: {
      en: (params) => ({
        text: `Adili: ${params.commission} has issued you a ${params.step.toLowerCase()} (${params.reference}). Act by ${longDate(params.actBy)}. Read it and respond at ${params.portalUrl}`,
      }),
    },
  }),
  'salary-stopped-email': define({
    channel: 'email',
    params: salaryStoppedParams,
    copy: { en: salaryStoppedEmail },
  }),
  'salary-stopped-sms': define({
    channel: 'sms',
    params: salaryStoppedParams,
    copy: {
      en: (params) => ({
        text: `Adili: ${params.commission} has stopped your salary from ${longDate(params.stoppedFrom)} pending compliance (${params.reference}). It is reinstated when you comply. Details at ${params.portalUrl}`,
      }),
    },
  }),
  'salary-reinstated-email': define({
    channel: 'email',
    params: salaryReinstatedParams,
    copy: { en: salaryReinstatedEmail },
  }),
  'salary-reinstated-sms': define({
    channel: 'sms',
    params: salaryReinstatedParams,
    copy: {
      en: (params) => ({
        text: `Adili: ${params.commission} sent your salary reinstatement to payroll on ${longDate(params.reinstatedOn)} (stoppage ${params.reference}). Details at ${params.portalUrl}`,
      }),
    },
  }),
} as const;
