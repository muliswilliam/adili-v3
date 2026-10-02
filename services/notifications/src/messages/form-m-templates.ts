import { RPT } from '@adili/numbering/references';
import { z } from 'zod';

import {
  define,
  email,
  longDate,
  NEVER_ASKS,
  paragraph,
  referenceOf,
  type RenderedEmail,
} from './template-kit.js';

/**
 * Templates of the Commission's compliance report to EACC (Form M, spec 09), by email to the
 * Commission's staff (their sign-in address): the draft is ready, the deadline is near, the report
 * was submitted, and EACC's chase of a report not received. Their params are what the reporting
 * service sends (its compliance report and national consolidation activities): the financial year,
 * dates and the reference only. The report names officers, so it stays behind sign-in.
 */

/** `2027/2028`: a financial year (1 July to 30 June), as reporting's `fyLabel` writes it. */
const financialYear = z
  .string()
  .refine(
    (label) =>
      /^\d{4}\/\d{4}$/.test(label) && Number(label.slice(5)) === Number(label.slice(0, 4)) + 1,
    { message: 'must be a financial year such as 2027/2028' },
  );

/** A civil date `YYYY-MM-DD` in Nairobi time, as the reporting service computes it. */
const civilDate = z.iso.date();

const dueFields = {
  financialYear,
  /** 31 July after the financial year: the deadline of Regs r.25(2). */
  dueDate: civilDate,
};

/** The due date must be 31 July after the year; compared only once both are valid. */
function dueAfterYear<T extends z.ZodType<{ financialYear: string; dueDate: string }>>(schema: T) {
  return schema.refine((params) => params.dueDate === `${params.financialYear.slice(5)}-07-31`, {
    path: ['dueDate'],
    message: 'must be 31 July after the financial year',
    when: (payload) =>
      payload.issues.every(
        (issue) => issue.path?.[0] !== 'financialYear' && issue.path?.[0] !== 'dueDate',
      ),
  });
}

const draftReadyParams = dueAfterYear(z.strictObject(dueFields));
type DraftReadyParams = z.infer<typeof draftReadyParams>;

const reminderParams = dueAfterYear(
  z.strictObject({
    ...dueFields,
    /** Whole days to the due date: 14, 7 or 1 before 31 July. */
    daysLeft: z.number().int().min(0).max(366),
  }),
);
type ReminderParams = z.infer<typeof reminderParams>;

const receiptParams = z.strictObject({
  financialYear,
  /** The report's reference (ADR-011), allocated on submission: `RPT-PSC-2028-0000001-4`. */
  reference: referenceOf([RPT], 'an RPT compliance report reference'),
  submittedOn: civilDate,
  /** Whether EACC received it after 31 July. */
  late: z.enum(['yes', 'no']),
});
type ReceiptParams = z.infer<typeof receiptParams>;

const chaseParams = dueAfterYear(
  z.strictObject({
    ...dueFields,
    /** The weekly chase's number, from 1 (the first week after 31 July). */
    round: z.number().int().min(1).max(100),
  }),
);
type ChaseParams = z.infer<typeof chaseParams>;

const days = (n: number) => (n === 1 ? '1 day' : `${String(n)} days`);

const OPEN_FORM_M = 'Open Form M in the Adili Online console';
const NOT_ATTACHED = 'The report is not attached to this email, because it lists officers by name.';
const LATE_ACCEPTED =
  'A report submitted after the due date is still accepted and recorded as late.';

function draftReadyEmail(params: DraftReadyParams): RenderedEmail {
  return email(`Form M for ${params.financialYear} is ready to review`, [
    paragraph(
      `Your Commission's Form M compliance report for the financial year ${params.financialYear} has been compiled from its roster, filings, clarifications and administrative actions, and is ready to review.`,
    ),
    paragraph(
      `A supervisor reviews it and adds remarks, and the commission admin completes Part I and Part B and confirms it with an identity check. It is due with EACC by ${longDate(params.dueDate)}.`,
    ),
    paragraph(`${OPEN_FORM_M} to review it. ${NOT_ATTACHED}`),
    paragraph(NEVER_ASKS),
  ]);
}

function reminderEmail(params: ReminderParams): RenderedEmail {
  const due = longDate(params.dueDate);
  const when =
    params.daysLeft === 0
      ? 'today'
      : params.daysLeft === 1
        ? 'tomorrow'
        : `in ${days(params.daysLeft)}`;
  return email(`Reminder: Form M for ${params.financialYear} is due ${when}`, [
    paragraph(
      `Your Commission has not yet submitted its Form M compliance report for the financial year ${params.financialYear} to EACC. It is due on ${due}, ${when}.`,
    ),
    paragraph(`${OPEN_FORM_M} to finish the review and confirm it. ${LATE_ACCEPTED}`),
    paragraph(NEVER_ASKS),
  ]);
}

function receiptEmail(params: ReceiptParams): RenderedEmail {
  return email(`Form M ${params.reference} submitted to EACC`, [
    paragraph(
      `Your Commission's Form M compliance report for the financial year ${params.financialYear} was submitted to EACC on ${longDate(params.submittedOn)}. Its reference number is ${params.reference}.`,
    ),
    ...(params.late === 'yes'
      ? [paragraph('EACC received it after the 31 July deadline, so it is recorded as late.')]
      : []),
    paragraph(
      `${OPEN_FORM_M} to download the signed Form M and EACC's acknowledgement of receipt. They are not attached to this email.`,
    ),
    paragraph(NEVER_ASKS),
  ]);
}

function chaseEmail(params: ChaseParams): RenderedEmail {
  return email(`Overdue: Form M for ${params.financialYear}`, [
    paragraph(
      `EACC has not received your Commission's Form M compliance report for the financial year ${params.financialYear}, which was due on ${longDate(params.dueDate)}.`,
    ),
    paragraph(
      'Regulation 25(2) requires every Responsible Commission to file it with EACC by 31 July after the financial year.',
    ),
    paragraph(`${OPEN_FORM_M} to complete and submit it. ${LATE_ACCEPTED}`),
    paragraph(
      `This is EACC's reminder number ${String(params.round)}. EACC sends one each week until the report is received.`,
    ),
    paragraph(NEVER_ASKS),
  ]);
}

/** The Form M templates, by template id; spread into `templates`. */
export const formMTemplates = {
  'form-m-draft-ready-email': define({
    channel: 'email',
    params: draftReadyParams,
    copy: { en: draftReadyEmail },
  }),
  'form-m-reminder-email': define({
    channel: 'email',
    params: reminderParams,
    copy: { en: reminderEmail },
  }),
  'form-m-receipt-email': define({
    channel: 'email',
    params: receiptParams,
    copy: { en: receiptEmail },
  }),
  'form-m-chase-email': define({
    channel: 'email',
    params: chaseParams,
    copy: { en: chaseEmail },
  }),
} as const;
