import { DIFF_HIGHLIGHT_PERCENT } from '@adili/ui';

/**
 * Copy for the case view (spec 07a FE-3), as the spec's frontend comment and the 07a-review
 * prototype word it. English now; Swahili slots stay empty until translated.
 */

/** "medium severity" for one indicator; "highest severity: high" for several. */
function pinnedSeverity(count: number, severity: string): string {
  const label = severity.toLowerCase();
  return count === 1 ? `${label} severity` : `highest severity: ${label}`;
}

export const en = {
  title: 'Case',
  fileNumber: (value: string) => `File no. ${value}`,
  typeAndCycle: (type: string, cycle: number) => `${type}, cycle ${String(cycle)}`,
  received: (date: string) => `Received ${date}`,
  amended: (date: string, previous: number) =>
    `Amended ${date}. Flags were recomputed against version ${String(previous)}; reviewed flags kept their notes.`,
  aboutVersion: 'About this version',
  lateFiling: 'Late filing',
  assignedTo: 'Assigned to',
  reviewersOfRecord: (count: number) =>
    `${String(count)} reviewer${count === 1 ? '' : 's'} of record`,
  reviewersOfRecordTip: (names: string) =>
    `Reviewers of record: ${names}. The supervisor who approves the determination must not be one of them.`,
  readOnly: (name: string) => `Read-only. ${name} holds this case.`,
  supervisorOfRecord:
    'You are a reviewer of record, so another supervisor must approve the determination.',
  actions: {
    claim: 'Claim',
    release: 'Release',
    reassign: 'Reassign',
    assign: 'Assign to a reviewer',
    unassign: 'Unassign',
    proposeDetermination: 'Propose determination',
    determination: 'Determination',
  },
  toasts: {
    reviewed: 'Marked reviewed',
    noteAdded: 'Note added',
    linkFailed: 'The attachment could not be downloaded. Try again.',
    forbidden: 'You cannot do this on this case. Reload to see who holds it.',
    stale: 'This case has changed. Reload to see it.',
    failed: 'We could not save this. Try again.',
    sessionEnded: 'Your session has ended. Sign in again.',
  },
  pane: {
    main: 'Declaration as filed',
    side: 'Review tools',
    handle: 'Resize review panel',
    switchLabel: 'Show',
    switchDeclaration: 'Declaration',
    switchReview: 'Flags and review',
  },
  declaration: {
    title: 'Declaration as filed',
    totals: 'Totals (KES)',
    total: 'Total',
    personal: 'Personal and employment details',
    spouses: 'Spouses',
    children: 'Dependent children under 18',
    statements: 'Financial statements',
    asAt: (date: string) => `as at ${date}`,
    income: '(b) Income',
    assets: '(c) Assets',
    liabilities: '(d) Liabilities',
    period: (from: string, to: string) => `${from} to ${to}`,
    nil: 'Nil declared',
    noneDeclared: 'None declared',
    other: 'Other information',
    noneGiven: 'None given',
    attachments: 'Attachments',
    noAttachments: 'No attachments',
    download: 'Download',
    downloadNamed: (name: string) => `Download ${name}`,
    declared: (when: string, version: number) =>
      `Solemn declaration made online on ${when} (version ${String(version)}).`,
    pins: (count: number) => `${String(count)} indicator${count === 1 ? '' : 's'}`,
    pinsLabel: (count: number, severity: string) =>
      `${String(count)} indicator${count === 1 ? '' : 's'} on this item, ${pinnedSeverity(count, severity)}. Show in flags.`,
    sectionPinsLabel: (count: number, severity: string) =>
      `${String(count)} indicator${count === 1 ? '' : 's'} on this section, ${pinnedSeverity(count, severity)}. Show in flags.`,
    unavailableTitle: 'The declaration could not be loaded.',
    unavailableBody: 'Flags, notes and clarifications are still available.',
    unreadableTitle: 'This declaration cannot be shown here.',
    unreadableBody: 'Its document is not in a form the console reads. Flags and notes still work.',
    tryAgain: 'Try again',
    unnamed: 'Unnamed',
  },
  compare: {
    title: 'Version comparison',
    toggle: (previous: number | null) =>
      previous === null
        ? 'Compare with previous declaration'
        : `Compare with version ${String(previous)}`,
    firstDeclaration: 'First declaration on Adili: nothing to compare.',
    loading: 'Loading the comparison',
    matched: (count: number) => `${String(count)} matched`,
    rulesFlagged: (count: number) => `${String(count)} changed ${String(DIFF_HIGHLIGHT_PERCENT)}%+`,
    oneVersionOnly: (count: number) => `${String(count)} in one version only`,
    span: (previous: string, current: string) => `${previous} → ${current}`,
    versionOn: (version: number, date: string | null) =>
      date ? `v${String(version)} ${date}` : `v${String(version)}`,
    howMatched: 'How items are matched',
    howMatchedBody: `Items are matched by person, category, type and description. "Not marked" means the declarant did not mark the change or the new item. Changes of ${String(DIFF_HIGHLIGHT_PERCENT)}% or more are shaded. An item up from nothing shows n/a for the percentage and counts as changed. Disposals are recorded under Other information.`,
    caption: (name: string, previous: number | null, current: number) =>
      `Changes for ${name} between ${previous === null ? 'the previous declaration' : `version ${String(previous)}`} and version ${String(current)}`,
    previousDeclaration: 'Previous declaration',
    previousColumn: 'Previous (KES)',
    nilBoth: 'Nil declared in both versions',
    noneTitle: 'Nothing to compare',
    noneBody: 'This is the first declaration on Adili for this person.',
    failedTitle: 'The comparison could not be loaded.',
    failedBody: 'The declaration as filed is still available. Turn Compare off to see it.',
  },
  tabs: {
    label: 'Case review',
    flags: 'Flags',
    registry: 'Registry',
    clarifications: 'Clarifications',
    notes: 'Notes',
    timeline: 'Timeline',
  },
  flags: {
    banner: 'Flags are indicators to guide your review. They are not findings.',
    counts: (open: number, reviewed: number, closed: number) =>
      `${String(open)} open · ${String(reviewed)} reviewed${closed ? ` · ${String(closed)} closed` : ''}`,
    howPriority: 'How priority is set',
    howPriorityTip:
      'Severity points: info 0, low 1, medium 3, high 7. A total below 3 is low priority, 3 to 9 medium, 10 or more high. Indicator for ordering only. Not a finding.',
    aboutIndicator: 'About this indicator',
    evidence: 'Evidence: ',
    goToItem: 'Go to item',
    markReviewed: 'Mark reviewed',
    explain: 'Explain',
    noteLabel: 'What did you conclude?',
    notePlaceholder: 'For example: the valuation report attached explains the increase',
    cancel: 'Cancel',
    reviewed: (count: number) => `Reviewed ${String(count)}`,
    reviewedBy: (name: string, date: string) => `Reviewed by ${name} on ${date}`,
    recomputed: 'Recomputed',
    recomputedTip: 'Kept after a new version was processed. The note stays with it.',
    closedGroup: (count: number) => `Closed by re-check ${String(count)}`,
    closedLine: 'Closed by a registry re-check: the registry no longer shows this.',
    noneTitle: 'No indicators',
    noneBody: 'The checks found nothing to point out.',
  },
  notes: {
    label: 'Add note',
    placeholder: 'What you checked and what is left',
    hint: 'Notes are internal to your Commission. The declarant never sees them.',
    add: 'Add note',
    list: 'Notes',
    emptyTitle: 'No notes yet',
    emptyBody: 'Notes help a colleague pick up this case.',
    counter: (length: string) => `${length} / 2,000`,
  },
  timeline: {
    emptyTitle: 'Nothing recorded yet',
    emptyBody: 'Claims, notes, reviewed flags and clarifications appear here.',
  },
  audit: 'Your access to this declaration is recorded in the audit trail.',
  notFound: {
    title: 'Case not found',
    body: 'The link may be wrong, or the case belongs to another Commission.',
    back: 'Back to overview',
  },
  loadFailed: {
    title: 'We could not load this case',
    body: 'The review service did not answer. Try again in a moment.',
    retry: 'Try again',
  },
};

export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
