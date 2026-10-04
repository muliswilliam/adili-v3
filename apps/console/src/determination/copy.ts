import { formatNumber, OUTCOME_BADGE_MESSAGES } from '@adili/ui';

import type { DeterminationOutcome } from '../server/review/types';

/**
 * The words of a determination's history and of the proposal's checks (spec 08 FE-2), for the
 * pure modules here; the screens' own copy is `components/determination/messages.ts`.
 */
export const DETERMINATION_COPY = {
  history: {
    proposed: (name: string, outcome: DeterminationOutcome) =>
      `Proposed by ${name}: ${OUTCOME_BADGE_MESSAGES[outcome]}`,
    returned: (name: string) => `Returned by ${name}`,
    approved: (name: string, reference: string | null) =>
      `Approved by ${name}${reference ? ` · ${reference}` : ''}`,
    withdrawn: (name: string) => `Withdrawn by ${name}`,
  },
  errors: {
    outcome: 'Choose a determination.',
    reasons: 'Enter your reasons.',
    reasonsTooLong: (max: number) => `Reasons can be up to ${formatNumber(max)} characters.`,
    note: 'Say what further action is needed.',
    noteTooLong: (max: number) =>
      `The further action can be up to ${formatNumber(max)} characters.`,
  },
} as const;
