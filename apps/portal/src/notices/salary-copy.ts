import { formatDate } from '@adili/ui';

import type { DeclarantNotice } from '../server/review/types';
import { COPY } from './copy';

type WhatToDo = DeclarantNotice['whatToDo'];

/** Copy for the declarant's salary stoppage and disciplinary referral (spec 08 FE-7, #208). */
export const SALARY_COPY = {
  stopped: COPY.salaryStopped,
  toComply: (whatToDo: WhatToDo) =>
    `To comply: ${whatToDo === 'file-declaration' ? 'file your declaration' : 'respond to your clarification'}.`,
  disciplinary: (commission: string) =>
    `${commission} has asked for disciplinary proceedings to start.`,
  disciplinaryBody: (whatToDo: WhatToDo) =>
    `Your salary remains stopped. You can still comply: ${
      whatToDo === 'file-declaration' ? 'file your declaration' : 'respond to your clarification'
    }.`,
  reinstating:
    'You have complied. Your salary reinstatement is being sent to payroll. We will SMS you when payroll confirms it.',
  reinstated: (date: string) =>
    `You have complied. Payroll confirmed your salary reinstatement on ${formatDate(date)}.`,
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
