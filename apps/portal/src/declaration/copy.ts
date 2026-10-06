import { formatDateTime } from '@adili/ui';

import { en, english } from './translatable';

/**
 * The one table of copy for spec 05b in the portal: Check registries, Read into the form, the
 * fields a suggestion fills, the KRA line, the roster pre-fill, the HR fields and the summary's
 * fold of sourced items. It sits beside the
 * declaration labels (`labels.ts`) and gets the same treatment: every entry has English and a
 * Swahili slot, empty until the Swahili copy is done (out of scope for spec 05b); screens read
 * English. Copy with values is a function in both languages. The rules modules
 * (`suggestions.ts`, `extraction.ts`, `roster-prefill.ts`) hold no words of their own, and the
 * ui components keep their own copy, replaced through their `messages` props.
 */

export const PREFILL_COPY = {
  /** The Check registries panel on a statement (#312). */
  registry: {
    heading: en('Registries'),
    check: en('Check registries'),
    checkAgain: en('Check again'),
    checking: en('Checking…'),
    checked: en((at: string) => `Checked ${formatDateTime(at)}`),
    toReview: en((count: number) => `${String(count)} to review`),
    /** How a spouse or child is named when Household has no first name for them. */
    spouseFallback: en('your spouse'),
    childFallback: en('this child'),
    noId: en((first: string) => `Add ${first}'s national ID in Household to check registries.`),
    // The declarant's own ID comes from their record, not Household, so only the roster can fix it.
    noOwnId: en(
      "Your record has no national ID. Ask your Commission's reporting officer to correct the roster, then check registries.",
    ),
    hide: en('Hide registry suggestions'),
    show: en('Show registry suggestions'),
    finished: en((name: string) => `Registry check finished for ${name}`),
    stoppedWaiting: en(
      (name: string) =>
        `Registry check stopped for ${name}: some registries did not answer. You can retry them.`,
    ),
    dismissedFold: en((count: number) => `Dismissed (${String(count)})`),
    dismissedAnnounce: en((title: string) => `Dismissed ${title}`),
    addValue: en((type: string) => `${type} · add the value yourself`),
    ownTax: en('Shown in Your details'),
    spouseTax: en((first: string) => `Adds to ${first}'s details in Household`),
    theirKraPin: en((first: string) => `${first}'s KRA PIN`),
    nothingToFill: en('Nothing to fill.'),
    apply: en('Apply'),
    added: en('Added. Enter its value.'),
    addedEdited: en('Added'),
    applied: en('Applied'),
    refreshedAdded: en('Refreshed your statement, then added'),
    refreshedApplied: en('Refreshed your statement, then applied'),
    startFailed: en('The registries could not be asked just now. Try again.'),
    acceptFailed: en('That could not be added just now. Try again.'),
    dismissFailed: en('That could not be dismissed just now. Try again.'),
    itemGone: en('That item is no longer in the statement.'),
    editTitle: en('Edit and add'),
    editSource: en((registry: string, date: string) => `From ${registry}, ${date}`),
    cancel: en('Cancel'),
    add: en('Add'),
  },
  /** Read into the form on an attachment (#316). */
  extraction: {
    menu: en('Read into the form'),
    notEnabled: en('Read into the form: not enabled for your Commission'),
    title: en('Read into the form'),
    kindLegend: en('What is this document?'),
    aiLabel: en('AI-assisted'),
    aiNote: en('You check every field before anything is added.'),
    read: en('Read document'),
    cancel: en('Cancel'),
    close: en('Close'),
    reading: en('Reading…'),
    readingHint: en('This can take up to a minute.'),
    reviewTitle: en('Check what was read'),
    reviewHint: en('Edit anything that is wrong.'),
    page: en((page: number) => `Page ${String(page)}`),
    checked: en('I checked this against the document'),
    yes: en('Yes'),
    kept: en((read: string) => `You already entered this, so it is kept. Read: ${read}`),
    replacing: en((entered: string) => `Replaces what you entered: ${entered}`),
    useRead: en('Use what was read'),
    tickLow: en((count: number) => `Tick the Low field${count === 1 ? '' : 's'} to continue.`),
    addNew: en('Add as new item'),
    applyHere: en('Apply to this item'),
    nothingRead: en(
      'Nothing could be read from this document. You can enter the details manually.',
    ),
    failed: en(
      (reason: string) =>
        `Could not read this document (${reason}). You can enter the details manually.`,
    ),
    tryAgain: en('Try again'),
    notEnabledBody: en('Reading documents into the form is not enabled for your Commission.'),
    applied: en('Details applied to this item'),
    added: en('Added as a new item'),
    applyFailed: en('The details could not be added. Try again.'),
    rowDetail: en('Read into the form'),
  },
  /**
   * Why a reading failed: the set's `reason` (`document-unavailable`, `document-unreadable`,
   * `not-read`, `unavailable`, `not-a-draft`), or what the portal saw itself.
   */
  failureReason: {
    unknown: en('the document could not be processed'),
    timeout: en('it took too long'),
    unavailable: en('the service is not available now'),
    refused: en('the file is not ready to be read'),
    missing: en('the file is no longer attached'),
    'document-unavailable': en('the file could not be fetched in time'),
    'document-unreadable': en('the file is damaged, too long, or of a type that cannot be read'),
    'not-read': en('nothing usable could be read from it'),
    'not-a-draft': en('the declaration was submitted while it was being read'),
  },
  /** The labels of the fields a document is read into, by their path in the item. */
  readField: {
    description: en('Description'),
    creditor: en('Creditor'),
    'details.parcelNumber': en('Parcel or plot number'),
    'details.size': en('Size'),
    'details.registration': en('Registration'),
    'details.makeModel': en('Make and model'),
    'details.issuer': en('Company or issuer'),
    'details.quantityOrPercent': en('Number or percentage'),
    'details.institution': en('Institution'),
    'details.accountType': en('Account type'),
    'details.debtor': en('Debtor'),
    'value.kesCents': en('Value'),
    'amount.kesCents': en('Amount'),
    'outstanding.kesCents': en('Outstanding balance'),
    'location.inKenya': en('In Kenya'),
    'location.county': en('County'),
    'location.country': en('Country'),
    'location.detail': en('Location'),
    'joint.isJoint': en('Jointly held'),
    'joint.sharePercent': en('Your share (%)'),
    'joint.coOwner': en('Co-owner relationship'),
  },
  /** The labels of the fields a suggestion carries or fills, by suggestion or item field name. */
  field: {
    registration: en('Registration'),
    make: en('Make'),
    model: en('Model'),
    year: en('Year'),
    makeModel: en('Make and model'),
    parcelNumber: en('Parcel or plot number'),
    size: en('Size'),
    location: en('Location'),
    county: en('County'),
    companyName: en('Company'),
    issuer: en('Company or issuer'),
    shares: en('Number or percentage'),
    kraPin: en('KRA PIN'),
    description: en('Description'),
  },
  /** What a suggestion reads as, beyond its fields' own values. */
  suggestion: {
    fallbackType: en('Suggestion'),
    landIn: en((location: string) => `Land in ${location}`),
    sharesIn: en((company: string) => `Shares in ${company}`),
    shareCount: en((shares: string) => `${shares} shares`),
    incomeHint: en(
      (amount: string) =>
        `KRA has ${amount} of income on record for the year. Add your salary and enter its amount for the income period yourself.`,
    ),
    incomeHintNoFigure: en(
      'KRA has income on record for you. Add your salary and enter its amount for the income period yourself.',
    ),
    directorship: en('Declare it under Other information, with your other directorships.'),
  },
  /** What KRA answers about a PIN: the card title and the line under Your details. */
  kra: {
    typeWord: en('KRA PIN'),
    pin: en((masked: string) => `KRA PIN ${masked}`),
    compliance: en((status: string) => `Compliance: ${status}`),
    checked: en((date: string) => `(checked ${date})`),
  },
  /** KRA compliance statuses as KRA sends them; any other is shown as sent. */
  complianceStatus: {
    compliant: en('Compliant'),
    'non-compliant': en('Not compliant'),
    'not-compliant': en('Not compliant'),
  },
  /** Your details (spec 05b S8). */
  roster: {
    hint: en("From your Commission's roster"),
  },
  /** The HR fields of Your details (#319), there and in the summary. */
  hr: {
    jobGroup: en('Job group'),
    appointmentDate: en('Date of appointment'),
    workStation: en('Work station'),
  },
  /** The HR fields' placeholders in Your details. */
  hrPlaceholder: {
    jobGroup: en('e.g. D3 (T-Scale 13)'),
    workStation: en('e.g. Eldoret, Uasin Gishu'),
  },
  /** The summary's fold of the items that came from a registry or a document (spec 05b S11). */
  summary: {
    sourcedItems: en(
      (count: number) =>
        `${count === 1 ? '1 item' : `${String(count)} items`} from registries or documents`,
    ),
  },
};

export const REGISTRY_COPY = english(PREFILL_COPY.registry);
export const EXTRACTION_COPY = english(PREFILL_COPY.extraction);
export const FAILURE_REASONS = english(PREFILL_COPY.failureReason);
export const FIELD_LABELS = english(PREFILL_COPY.field);
export const READ_FIELD_LABELS: Record<string, string> = english(PREFILL_COPY.readField);
export const SUGGESTION_COPY = english(PREFILL_COPY.suggestion);
export const KRA_COPY = english(PREFILL_COPY.kra);
export const COMPLIANCE_WORDS: Record<string, string> = english(PREFILL_COPY.complianceStatus);
export const ROSTER_HINT = PREFILL_COPY.roster.hint.en;
export const HR_LABELS = english(PREFILL_COPY.hr);
export const HR_PLACEHOLDERS = english(PREFILL_COPY.hrPlaceholder);
export const SUMMARY_COPY = english(PREFILL_COPY.summary);
