import { formatNumber, plural } from '@adili/ui';

/**
 * Copy of the approvals inbox shared by every kind (spec 08 FE-3): the page, its tabs, counts and
 * pager, reassigning, and the frame of the refusal dialog. Each kind's own copy (its tab, cards,
 * decision dialogs and refusals) is in its own messages file, e.g. `determination-messages.ts`.
 */
export const messages = {
  title: 'Approvals',
  /** Every pending approval, of every kind: what the age bands count too. */
  summary: (count: number) =>
    count === 0 ? 'Nothing waits for approval' : `${formatNumber(count)} awaiting approval`,
  tabsLabel: 'Kinds of approval',
  /** Bulk closures are not inbox items: the low-risk clean cases the sweep proposes (#202). */
  bulkClosure: 'Bulk closure',
  age: {
    label: 'Waiting',
    under7Days: 'Under 7 days',
    from7To30Days: '7 to 30 days',
    over30Days: 'Over 30 days',
  },
  reassign: 'Reassign to another supervisor',
  reassignedToYou: 'Reassigned to you',
  reassignedTo: (name: string) => `Reassigned to ${name}`,
  emptyTitle: 'All caught up',
  emptyBody: 'Nothing is waiting for approval.',
  loadFailed: {
    title: 'Could not load approvals',
    body: 'Nothing has changed. Try again in a moment.',
    retry: 'Try again',
  },
  noAccess: 'Approvals are for supervisors.',
  pager: {
    pagination: 'Approvals pages',
    pageRange: (from: number, to: number) => `Showing ${String(from)}-${String(to)}`,
    pageRows: (count: number) => `Showing ${plural(count, 'approval')}`,
    previousPage: 'Previous page',
    nextPage: 'Next page',
  },
  reassignDialog: {
    title: 'Reassign to another supervisor',
    legend: 'Supervisor',
    supervisor: 'Supervisor',
    proposer: 'Proposed this',
    loading: 'Loading supervisors…',
    failed: 'The list of supervisors could not be loaded.',
    none: 'Your Commission has no other supervisor.',
    pick: 'Choose a supervisor.',
    hint: 'It shows in their inbox as reassigned to them. Whoever approves, the separation of duties still applies.',
    cancel: 'Cancel',
    confirm: 'Reassign',
  },
  /** Reassigning something decided meanwhile (409 `not-proposed`). */
  decided: {
    title: 'Already decided',
    body: 'Someone decided this while the page was open.',
    after: 'The list has been refreshed. Nothing was changed by you.',
  },
  notice: { ok: 'OK' },
  toasts: {
    reassigned: (name: string) => `Reassigned to ${name}`,
    failed: 'That did not work. Try again in a moment.',
    sessionEnded: 'Your session has ended. Sign in again.',
  },
} as const;
