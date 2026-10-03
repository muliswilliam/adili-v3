import { formatNumber, OUTCOME_BADGE_MESSAGES } from '@adili/ui';

const NO_ISSUES = OUTCOME_BADGE_MESSAGES['compliant-no-issues'];

/**
 * Copy of the bulk closure screen (spec 08 FE-4). English; the Swahili slots come with the i18n
 * pass. The batch's own words (ready, running, done, stopped) are `BatchSelector`'s, except the
 * ones the spec words for this screen.
 */
export const en = {
  title: 'Bulk closure',
  filters: 'Filters',
  filtersLocked: 'Filters are locked while approval runs.',
  cycleLabel: 'Cycle',
  cycleOption: (year: number) => `Cycle ${String(year)}`,
  typeLabel: 'Type',
  typeAll: 'All types',
  types: { initial: 'Initial', biennial: 'Biennial', final: 'Final' },
  bandLabel: 'Priority band',
  bandLow: 'Low only',
  entityLabel: 'Reporting entity',
  entityAll: 'All reporting entities',

  countsLabel: 'Closures for these filters',
  eligible: 'Eligible proposals',
  eligibleDescription: NO_ISSUES,
  sampled: 'Sampled for review',
  sampleRate: (rate: number) => `${formatPercent(rate)} sample`,
  reviewQueue: 'Review queue',
  approved: 'Already approved',
  approvedDescription: 'Each with its CMP number',

  pendingDescription: (date?: string) =>
    date === undefined
      ? 'Bulk proposals appear after the clarification window closes.'
      : `Bulk proposals appear after the clarification window closes on ${date}.`,
  /** The window has closed; the sweep proposes on its next daily run. */
  pendingSweep: 'Bulk proposals appear after the next daily sweep.',

  confirmTitle: (count: string) => `Approve ${count} closures?`,
  confirmFilters: (cycle: number, type: string) =>
    `Cycle ${String(cycle)} · ${type} · Low priority`,
  confirmBody:
    'Each closure receives a CMP number in your name. Sampled cases are excluded and appear in the review queue.',
  consequences: 'When you approve',
  allocated: (count: string) => `${count} CMP numbers are allocated in order`,
  allocatedDetail: (size: string) => `No gaps, in chunks of ${size}`,
  determined: `Each case is determined as ${NO_ISSUES}`,
  notified: 'Each declarant is notified',
  notifiedDetail: 'By email, SMS and in the portal',
  letters: 'Decision letters are prepared on demand',
  lettersDetail: 'The first time someone asks for one',
  cancel: 'Cancel',
  confirm: (count: string) => `Approve ${count} closures`,

  stoppedUnavailable: 'The review service did not respond.',

  helpTitle: 'How cases are proposed and sampled',
  helpIntro: 'A case is proposed when:',
  helpRules: [
    'its priority band is low',
    'it has no open flags (none, or all reviewed)',
    'it has no open clarification',
    'it has no determination yet',
    'the clarification window for the cycle has closed',
  ],
  helpWindow: (date: string) => `The window closed on ${date}.`,
  helpWindowCloses: (date: string) => `The window closes on ${date}.`,
  helpSample: (rate: number) => `Sample: ${formatPercent(rate)}.`,
  helpSampleBody:
    'A fixed rule on the case and cycle picks the sample, so the same case is always picked. Picked cases go back to the review queue marked Sampled.',
  helpSwept: (at: string) => `The daily sweep last ran on ${at}.`,
  helpNotSwept: 'The daily sweep has not run for this cycle yet.',
  helpLetters: 'Letters on demand.',
  helpLettersBody:
    'Decision letters for bulk closures are prepared the first time the declarant or an officer asks for one.',

  supervisorsOnly: 'Only a supervisor can approve bulk closures.',
  errorTitle: 'We could not load the bulk closures',
  errorDetail: 'Check your connection and try again.',
  tryAgain: 'Try again',
};

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

/** 0.02 → "2%", 0.025 → "2.5%". */
function formatPercent(rate: number): string {
  return `${formatNumber(Math.round(rate * 1000) / 10)}%`;
}
