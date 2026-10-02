import { formatDate, formatDateTime, plural } from '@adili/ui';

/**
 * Copy of the case view (spec 07a FE-3): the header, the assignment actions and their dialogs,
 * the declaration pane, the flags, notes and timeline tabs. English; the Swahili slots come
 * with the i18n pass.
 */
export const CASE_COPY = {
  title: 'Review case',
  type: { initial: 'Initial', biennial: 'Biennial', final: 'Final' },
  typeCycle: (type: string, cycle: number) => `${type}, cycle ${String(cycle)}`,
  fileNumber: (number: string) => `File no. ${number}`,
  received: (at: string) => `Received ${formatDate(at)}`,
  lateFiling: 'Late filing',
  version: (n: number, of: number) => `Version ${String(n)} of ${String(of)}`,
  versionNote: (amendedAt: string, previous: number) =>
    `Amended ${formatDate(amendedAt)}. Indicators were recomputed against version ${String(previous)}; reviewed indicators kept their notes.`,
  aboutVersion: 'About this version',
  windowOpen: (closes: string, daysLeft: number) =>
    `Window closes ${formatDate(closes)} · ${daysLeft === 0 ? 'today' : `${plural(daysLeft, 'day')} left`}`,
  windowClosed: (closed: string) => `Window closed ${formatDate(closed)}`,
  assignedTo: 'Assigned to',
  reviewersOfRecord: (count: number) => `${plural(count, 'reviewer')} of record`,
  reviewersOfRecordTip: (names: string) =>
    `Reviewers of record: ${names}. The supervisor who approves the determination must not be one of them.`,
  readOnly: (holder: string) => `Read-only. ${holder} holds this case.`,
  separation: 'You are a reviewer of record, so another supervisor must approve the determination.',
  audit: 'Your access to this declaration is recorded in the audit trail.',

  claim: 'Claim',
  release: 'Release',
  reassign: 'Reassign',
  assign: 'Assign to a reviewer',
  unassign: 'Unassign',
  claimed: 'Case claimed. You hold it now.',
  claimConflict: (holder: string) => `Already claimed by ${holder}`,
  released: 'Case released to the queue',
  reassigned: (name: string) => `Reassigned to ${name}`,
  assigned: (name: string) => `Assigned to ${name}`,
  unassigned: 'Case unassigned',
  actionFailed: 'We could not save this. Try again.',
  sessionEnded: 'Your session has ended. Sign in again.',
  stale: 'This case has changed. It now shows the latest.',

  claimDialog: {
    title: 'Claim this case?',
    body: (reference: string, name: string) => `You will hold ${reference} for ${name}.`,
    separation:
      'You become a reviewer of record. Another supervisor, who has never held this case, must approve its determination.',
    confirm: 'Claim case',
  },
  releaseDialog: {
    title: 'Release this case?',
    body: (reference: string) =>
      `${reference} returns to the queue unassigned. Your notes and reviewed flags stay, and you remain a reviewer of record.`,
    keep: 'Keep it',
    confirm: 'Release case',
  },
  unassignDialog: {
    title: 'Unassign this case?',
    body: (reference: string, holder: string) =>
      `${reference} returns to the queue unassigned. ${holder} remains a reviewer of record; their notes stay.`,
    confirm: 'Unassign',
  },
  reassignDialog: {
    title: (held: boolean) => (held ? 'Reassign case' : 'Assign case'),
    heldBy: (holder: string) => `Currently held by ${holder}.`,
    assignTo: 'Assign to',
    you: '(you)',
    load: (open: number) => plural(open, 'open case'),
    ofRecord: 'already a reviewer of record',
    none: 'No other officer of your Commission holds a review case yet.',
    loading: 'Loading officers…',
    failed: 'The list of officers could not be loaded.',
    hint: 'Officers who hold review cases in your Commission, with the cases they hold.',
    pick: 'Choose an officer.',
    confirm: (held: boolean) => (held ? 'Reassign' : 'Assign'),
  },
  cancel: 'Cancel',
  retry: 'Try again',

  declaration: {
    title: 'Declaration as filed',
    unavailableTitle: 'The declaration could not be loaded.',
    unavailableBody: 'Flags, notes and clarifications are still available.',
    downloadFailed: 'The document could not be downloaded. Try again.',
    pinned: (count: number) => plural(count, 'indicator'),
    pinnedLabel: (count: number) => `${plural(count, 'indicator')} on this item. Show in flags.`,
  },

  tabsLabel: 'Case review',
  views: { label: 'Show', declaration: 'Declaration', review: 'Flags and review' },
  resizeLabel: 'Resize review panel',

  flags: {
    banner: 'Flags are indicators to guide your review. They are not findings.',
    counts: (open: number, reviewed: number, closed: number) =>
      [
        `${String(open)} open`,
        `${String(reviewed)} reviewed`,
        closed ? `${String(closed)} closed` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    howPriority: 'How priority is set',
    howPriorityTip:
      'Severity points: info 0, low 1, medium 3, high 7. Total below 3 is low priority, 3 to 9 medium, 10 or more high. Indicator for ordering only. Not a finding.',
    severity: { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' },
    reviewedGroup: 'Reviewed',
    closedGroup: 'Closed by re-check',
    emptyTitle: 'No indicators',
    emptyBody: 'The checks found nothing to point out.',
    aboutIndicator: 'About this indicator',
    evidence: 'Evidence: ',
    recomputed: 'Recomputed',
    recomputedTip: (version: number) =>
      `Kept after version ${String(version)} was processed. The note stays with it.`,
    goToItem: 'Go to item',
    markReviewed: 'Mark reviewed',
    noteLabel: 'What did you conclude?',
    notePlaceholder: 'For example: the valuation report attached explains the increase',
    noteRequired: 'Add a note to record what you concluded.',
    noteTooLong: 'Notes can be up to 1,000 characters.',
    reviewedBy: (name: string, at: string) => `Reviewed by ${name} on ${formatDate(at)}`,
    closedNote: 'Closed by re-check: the registry no longer shows this.',
    marked: 'Marked reviewed',
    alreadyReviewed: 'Someone marked this flag reviewed first. It now shows their note.',
    holderOnly: 'Only the officer holding the case marks flags reviewed.',
  },

  clarifications: {
    emptyTitle: 'No clarifications yet',
    emptyBody: 'None issued for this case.',
    draft: 'Draft (no reference yet)',
    issued: (at: string) => `Issued ${formatDate(at)}`,
    due: (at: string) => `due ${formatDate(at)}`,
    responded: (at: string) => `responded ${formatDate(at)}`,
    resolved: (at: string) => `resolved ${formatDate(at)}`,
    late: 'Late',
  },

  notes: {
    label: 'Add note',
    placeholder: 'What you checked and what is left',
    hint: 'Notes are internal to your Commission. The declarant never sees them.',
    add: 'Add note',
    added: 'Note added',
    required: 'Write a note first.',
    tooLong: 'Notes can be up to 2,000 characters.',
    emptyTitle: 'No notes yet',
    emptyBody: 'Notes help a colleague pick up this case.',
    max: 2000,
  },

  timeline: {
    label: 'Case timeline',
    emptyTitle: 'Nothing recorded yet',
    emptyBody: 'Events on this case appear here.',
  },

  loadFailedTitle: 'We could not load this case',
  loadFailedBody: 'The review service did not answer. Try again in a moment.',
  notFoundTitle: 'Case not found',
  notFoundBody: 'The link may be wrong, or the case belongs to another Commission.',
  backToOverview: 'Back to overview',
} as const;

/** A flag's review note, as the service takes it. */
export const FLAG_NOTE_MAX = 1000;

/**
 * Copy of the Registry tab and the registry Re-check (spec 07b FE-2). English; the Swahili
 * slots come with the i18n pass. Registry names are the registries' own.
 */
export const REGISTRY_COPY = {
  tab: 'Registry',
  attention: 'A registry could not be checked',
  header:
    'Registry checks compare the declaration with KRA, NTSA, BRS and ArdhiSasa. Mismatches are indicators for your review, not findings.',
  lastChecked: (at: string) => `Last checked ${formatDateTime(at)}`,
  notCheckedYet: 'Not checked yet',
  personLabel: (name: string) => `Registry checks for ${name}`,
  relation: { officer: 'Declarant', spouse: 'Spouse', child: 'Child' },
  noIdTitle: 'Not checked: no national ID declared',
  noIdBody: (name: string) => `Registries cannot be checked for ${name} without an ID.`,
  loadFailed: 'Registry records could not be loaded. Status is shown from the last check.',
  loading: 'Loading registry checks',
  emptyTitle: 'No national IDs declared',
  emptyBody: 'Registries are checked by national ID. None was declared for this household.',
  flagsLabel: (system: string) => `${system} indicators`,

  rows: {
    matched: (count: number) => `${plural(count, 'record')}, all declared`,
    allDeclared: 'All records declared',
    noRecords: 'No records found',
    kraMatched: 'PIN on record, compliant, income within 25%',
    kraMatchedNoIncome: 'PIN on record, compliant',
    mismatched: (count: number) => plural(count, 'indicator'),
    mismatchedNoCount: 'Mismatches found',
    unavailable: (system: string) =>
      `Could not reach ${system}. Re-checked automatically every hour.`,
    notChecked: 'Checks run after submission.',
    noIdRow: 'No national ID declared',
  },

  table: {
    registered: (date: string) => `registered ${date}`,
    appointed: (date: string) => `appointed ${date}`,
    shares: (count: number) => `${count.toLocaleString('en-KE')} shares`,
    notInRegistry: {
      ardhisasa: 'ArdhiSasa has no parcel with this number',
      ntsa: 'NTSA has no vehicle with this registration',
      brs: 'BRS has no company with this registration number',
    },
    supplier: (employer: string | null) =>
      employer ? `On the ${employer} supplier list` : "On the employer's supplier list",
    goToItem: 'Go to item',
  },

  kra: {
    recordColumn: 'KRA record',
    declaredColumn: 'Compared with the declaration',
    caption: 'KRA record compared with the declaration. Income is shown as a percentage only.',
    pin: 'PIN',
    onRecord: 'On record',
    pins: (count: number) => `${String(count)} PINs on record`,
    noPin: 'No PIN for this ID',
    compliance: 'Tax compliance',
    statuses: { compliant: 'Compliant', 'non-compliant': 'Not compliant', unknown: 'Unknown' },
    validUntil: (date: string) => `Certificate valid until ${date}`,
    noCertificate: 'No valid compliance certificate',
    income: 'Income declared to KRA',
    incomeDifference: (percent: number) =>
      `KRA-declared income differs by ${String(percent)}% from the income declared here.`,
    incomeNotCompared: 'Income declared to KRA could not be compared.',
  },

  recheck: {
    action: 'Re-check',
    running: 'Checking…',
    forbidden: 'Only the assigned reviewer or a supervisor can re-check the registries.',
    title: 'Re-check registries',
    body: 'Re-check all registries for this case? Reviewed flags keep your notes.',
    note: 'Indicators that no longer apply are closed.',
    confirm: 'Re-check',
    done: 'Registry checks updated',
    slow: 'The re-check is still running. Its results appear on the Registry tab when it finishes.',
    cooldown: (minutes: string) => `Re-checked recently. Try again in ${minutes}.`,
    closed: 'This case is determined. Its registries are no longer checked.',
  },
} as const;
