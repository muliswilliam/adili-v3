import { plural } from '@adili/ui';

/** Copy of the referrals tab of the approvals inbox (spec 08 FE-3, FE-6, S13). */
export const messages = {
  tab: 'Referrals',
  approve: 'Approve',
  decline: 'Decline',
  openReferral: 'Open referral',
  file: (number: string) => `File ${number}`,
  cycle: (year: number) => `Cycle ${String(year)}`,
  evidence: {
    label: 'What it rests on',
    flags: (count: number) => plural(count, 'flag'),
    clarifications: (count: number) => plural(count, 'clarification'),
    obligations: (count: number) => plural(count, 'obligation'),
    /** The ladder's issued steps a referral includes, counted by their letters. */
    actionLetters: (count: number) => plural(count, 'letter'),
  },
  /** 403 from approve, after the inbox said the viewer could. */
  refused: {
    title: 'You cannot approve this',
    'reviewer-of-record': 'You cannot approve this: you reviewed this case.',
    proposer: 'You proposed this.',
    role: 'Only a supervisor can approve a referral to EACC.',
    separationAfter:
      'You proposed it or held its case after this page loaded, so another supervisor must approve it.',
    roleAfter: 'Your account is not a supervisor of this Commission any more.',
  },
  /** 403 from decline. */
  declineRefused: {
    title: 'You cannot decline this',
    'reviewer-of-record': 'You cannot decline this: you reviewed this case.',
    proposer: 'You proposed this.',
    role: 'Only a supervisor can decline a referral to EACC.',
    separationAfter:
      'You proposed it or held its case after this page loaded, so another supervisor must decide it.',
    roleAfter: 'Your account is not a supervisor of this Commission any more.',
  },
} as const;
