import { formatDate } from '@adili/ui';

import type { DeclarantNotice } from '../server/review/types';
import { complyBy, COPY } from './copy';

type Subject = DeclarantNotice['subject'];

/** Copy for the declarant's salary stoppage and disciplinary referral (spec 08 FE-7, #208). */
export const SALARY_COPY = {
  stopped: COPY.salaryStopped,
  toComply: (subject: Subject) => `To comply: ${complyBy(subject)}.`,
  disciplinary: (commission: string) =>
    `${commission} has asked for disciplinary proceedings to start.`,
  disciplinaryBody: (subject: Subject) =>
    `Your salary remains stopped. You can still comply: ${complyBy(subject)}.`,
  reinstating: {
    complied:
      'You have complied. Your salary reinstatement is being sent to payroll. We will SMS you when payroll confirms it.',
    ended:
      'This notice has closed. Your salary reinstatement is being sent to payroll. We will SMS you when payroll confirms it.',
  },
  reinstated: (date: string) =>
    `Payroll confirmed your salary reinstatement on ${formatDate(date)}.`,
  card: {
    title: 'Your salary',
    stoppedOn: 'Salary stopped',
    instruction: 'Payroll instruction',
    reinstatement: 'Reinstatement',
    whenYouComply: 'Automatic when you comply',
    beingSent: 'Being sent to payroll',
    confirmed: (date: string) => `Confirmed ${formatDate(date)}`,
  },
} as const;
