import { formatDate } from '@adili/ui';

import type { ActionStep } from '../../server/actions.server';

/**
 * Copy for the ladder's salary stoppage and disciplinary referral (spec 08 FE-3, FE-5; #208; S6,
 * S7, S10, S15): payroll instructions and their acknowledgements, what came before a step, and
 * what approving or declining a grave step does. English only.
 */
export const stoppageCopy = {
  salaryStopped: 'Salary stopped',
  stoppageWindowEnds: 'Stoppage window ends',
  payroll: {
    stop: 'Stop-salary instruction',
    resume: 'Reinstatement instruction',
    acknowledged: 'Acknowledged',
    waiting: 'Waiting for payroll',
    failed: 'Refused by payroll',
    instructionReference: 'Instruction reference',
    action: 'Action',
    payrollReference: 'Payroll reference',
    notYet: 'Not yet',
    receivedAt: 'Received at',
    waitingNote: {
      stop_salary:
        'Waiting for payroll to acknowledge it. The salary is not stopped and no letter is issued until then.',
      resume_salary: 'Waiting for payroll to acknowledge it. The salary stays stopped until then.',
    },
  },
  stepper: {
    salaryStopped: (date: string) => `Salary stopped ${formatDate(date)}`,
    stopAcknowledged: (date: string) => `Payroll acknowledged ${formatDate(date)}`,
    resumeAcknowledged: (date: string) => `Reinstatement acknowledged ${formatDate(date)}`,
    waiting: 'Waiting for payroll',
  },
  reinstatementAcknowledged: (date: string) =>
    `Salary reinstatement acknowledged ${formatDate(date)}.`,
  before: {
    title: 'What came before',
    earlier: 'Earlier steps',
    attachments: (n: number) => `${String(n)} ${n === 1 ? 'document' : 'documents'}`,
    firstStep: 'No earlier steps. This is the first step of the ladder.',
    issued: (date: string) => `Issued ${formatDate(date)}`,
    approvedBy: (name: string) => `approved by ${name}`,
    actBy: (date: string) => `act by ${formatDate(date)}`,
    stoppageWindowEnds: (date: string) => `stoppage window ends ${formatDate(date)}`,
    response: (date: string) => `Response ${formatDate(date)}:`,
    noResponse: 'No response from the declarant',
    loading: 'Loading the earlier steps',
    failed: 'The earlier steps could not be loaded.',
    retry: 'Try again',
  },
  approve: {
    payrollCallout: (name: string) =>
      `Approving sends a stop-salary instruction to payroll for ${name}.`,
    adm: 'An ADM number is allocated in your name',
    admPayroll: 'It is also the payroll instruction reference',
    payroll: 'Payroll receives a stop_salary instruction',
    payrollDetail: (file: string) =>
      `With the reporting entity's code, personnel file number ${file} and ID number from the roster record`,
    stoppageLetter: 'The salary stoppage letter is issued when payroll acknowledges',
    letterDetail: 'Restricted, with a QR code',
    disciplinaryLetter: 'A disciplinary referral letter is issued to the declarant',
    reportingEntity: 'The reporting entity is told to start disciplinary proceedings',
    // No message goes out for a referral (spec 08 S10): the declarant finds the letter in the portal.
    disciplinaryLetterDetail:
      'Restricted, with a QR code; the declarant finds it under Notices in the portal',
    reportingEntityDetail:
      'Recorded as an event for the reporting entity; the ladder then waits for compliance',
    reinstatedDetail: 'Salary is reinstated automatically when they comply',
    read: 'I have read the notice, the warning and any responses',
    confirmStoppage: 'Approve and stop salary',
  },
  approvedDetail: {
    'salary-stoppage':
      'The stop-salary instruction goes to payroll; the letter is issued once payroll acknowledges it.',
    'disciplinary-referral': 'The letter is issued and the reporting entity told to act.',
  } as Partial<Record<ActionStep, string>>,
} as const;
