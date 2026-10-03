import { formatDate } from '@adili/ui';

import type { ActionStep } from '../../server/actions.server';
import { stepLabel } from '../actions/messages';

/** Copy of the actions tab of the approvals inbox (spec 08 FE-3, FE-5; S5, S8, S9, S14). */
export const messages = {
  tab: 'Actions',
  openLadder: 'Open ladder',
  approve: 'Approve',
  approveStoppage: 'Approve stoppage',
  decline: 'Decline',
  fileNumber: (n: string) => `File ${n}`,
  firstStep: 'First step: nothing was issued before it.',
  prior: (step: ActionStep, reference: string | null, issuedAt: string | null) =>
    `${stepLabel(step)}${reference ? ` ${reference}` : ''}${issuedAt ? `, issued ${formatDate(issuedAt)}` : ''}`,
  noResponse: 'No response from the declarant.',
  responded: (date: string, attachments: number) =>
    `Responded ${formatDate(date)}${
      attachments > 0
        ? ` with ${String(attachments)} ${attachments === 1 ? 'document' : 'documents'}`
        : ''
    }:`,
  /** 403 from approve or decline, after the inbox said the viewer could. */
  refused: {
    title: 'You cannot approve this',
    separationAfter:
      'You proposed it or held the case after this page loaded, so another supervisor must decide it.',
    roleAfter: 'Your account is not a supervisor of this Commission any more.',
  },
  decided: {
    title: 'Already decided',
    after: 'The list has been refreshed. Nothing was changed by you.',
  },
  toasts: {
    approved: (step: ActionStep, reference: string | null) =>
      reference
        ? `${stepLabel(step)} approved. ${reference} allocated.`
        : `${stepLabel(step)} approved`,
    declined: (step: ActionStep) =>
      step === 'disciplinary-referral'
        ? `${stepLabel(step)} declined. The ladder waits for compliance.`
        : `${stepLabel(step)} declined. The ladder has ended.`,
  },
} as const;
