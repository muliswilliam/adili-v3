import { formatDateTime, plural } from '@adili/ui';

/**
 * Copy of the assignment actions and their dialogs, shared by the queue's rows and the case view
 * (spec 07a FE-2, FE-3), and of the case view's Registry tab and Re-check (spec 07b FE-2). The
 * rest of the case view's copy is `components/review/case/messages.ts`. English; the Swahili
 * slots come with the i18n pass.
 */
export const CASE_COPY = {
  type: { initial: 'Initial', biennial: 'Biennial', final: 'Final' },

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
    none: 'Your Commission has no other reviewer.',
    loading: 'Loading reviewers…',
    failed: 'The list of reviewers could not be loaded.',
    hint: 'Reviewers and supervisors of your Commission, with the cases they hold.',
    pick: 'Choose a reviewer.',
    confirm: (held: boolean) => (held ? 'Reassign' : 'Assign'),
  },
  cancel: 'Cancel',
  retry: 'Try again',
};

export const REGISTRY_COPY = {
  tab: 'Registry',
  attention: 'A registry could not be checked',
  header:
    'Registry checks compare the declaration with KRA, NTSA, BRS and ArdhiSasa. Mismatches are indicators for your review, not findings.',
  lastChecked: (at: string) => `Last checked ${formatDateTime(at)}`,
  notCheckedYet: 'Not checked yet',
  personLabel: (name: string) => `Registry checks for ${name}`,
  relation: { declarant: 'Declarant', spouse: 'Spouse', child: 'Child' },
  /** The one row of someone without a national ID: no registry can be asked. */
  noIdRegistries: 'All registries',
  noIdBody: (name: string) => `Registries cannot be checked for ${name} without an ID.`,
  loadFailed: 'Registry records could not be loaded. Status is shown from the last check.',
  loading: 'Loading registry checks',
  emptyTitle: 'No national IDs declared',
  emptyBody: 'Registries are checked by national ID. None was declared for this household.',
  flagsLabel: (system: string) => `${system} indicators`,

  rows: {
    matched: (count: number) => `${plural(count, 'record')}, all declared`,
    allDeclared: 'All records declared',
    /** A registry that answered with notes (info flags): its records, not "all declared". */
    records: (count: number) => plural(count, 'record'),
    noIndicators: 'No indicators',
    supplierCheckNotRun: 'supplier check not run',
    notes: (count: number) => plural(count, 'note'),
    noRecords: 'No records found',
    kraMatched: 'PIN on record, compliant, income within 25%',
    kraMatchedNoIncome: 'PIN on record, compliant',
    mismatched: (count: number) => plural(count, 'indicator'),
    mismatchedNoCount: 'Mismatches found',
    unavailable: (system: string) =>
      `Could not reach ${system}. Re-checked automatically every hour.`,
    supplierListUnavailable:
      "Could not reach the employer's supplier list. Re-checked automatically every hour.",
    notChecked: 'Checks run after submission.',
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

/** What a version comparison row says about the declarant's marking (spec 07a FE-3, S10). */
export const COMPARE_COPY = {
  marked: 'Marked as changed',
  notMarked: 'Not marked',
  markedNew: 'marked as new',
  notMarkedNew: 'not marked',
} as const;
