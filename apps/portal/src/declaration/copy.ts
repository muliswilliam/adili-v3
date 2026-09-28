import { formatDateTime } from '@adili/ui';

import type { Label } from './labels';

/**
 * The one table of copy for spec 05b in the portal: Check registries, Read into the form, the
 * fields a suggestion fills, the KRA line and the roster pre-fill. It sits beside the
 * declaration labels (`labels.ts`) and gets the same treatment: every entry has English and a
 * Swahili slot, empty until the Swahili copy is done (out of scope for spec 05b); screens read
 * English. Copy with values is a function in both languages. The rules modules
 * (`suggestions.ts`, `extraction.ts`, `roster-prefill.ts`) hold no words of their own, and the
 * ui components keep their own copy, replaced through their `messages` props.
 */

/** Copy with values: English, and a Swahili slot of the same shape, empty until translated. */
export interface Phrase<A extends unknown[]> {
  en: (...args: A) => string;
  /** Empty until translated. */
  sw: ((...args: A) => string) | '';
}

function en(text: string): Label;
function en<A extends unknown[]>(text: (...args: A) => string): Phrase<A>;
function en<T>(text: T): { en: T; sw: '' } {
  return { en: text, sw: '' };
}

type English<T> = { [K in keyof T]: T[K] extends { en: infer E } ? E : never };

function english<T extends Record<string, { en: unknown; sw: unknown }>>(table: T): English<T> {
  return Object.fromEntries(
    Object.entries(table).map(([key, entry]) => [key, entry.en]),
  ) as English<T>;
}

export const COPY = {
  /** The Check registries panel on a statement (#312). */
  registry: {
    heading: en('Registries'),
    check: en('Check registries'),
    checkAgain: en('Check again'),
    checking: en('Checking…'),
    checked: en((at: string) => `Checked ${formatDateTime(at)}`),
    toReview: en((count: number) => `${String(count)} to review`),
    noId: en((first: string) => `Add ${first}'s national ID in Household to check registries.`),
    noOwnId: en('Add your national ID in Household to check registries.'),
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
    officerTax: en('Shown in Your details'),
    spouseTax: en((first: string) => `Adds to ${first}'s details in Household`),
    theirKraPin: en((first: string) => `${first}'s KRA PIN`),
    pinOnFile: en('Nothing to fill.'),
    apply: en('Apply'),
    added: en('Added. Enter its value.'),
    addedEdited: en('Added'),
    applied: en('Applied'),
    refreshedAdded: en('Refreshed your statement, then added'),
    refreshedApplied: en('Refreshed your statement, then applied'),
    startFailed: en('The registries could not be asked just now. Try again.'),
    acceptFailed: en('That could not be added just now. Try again.'),
    dismissFailed: en('That could not be dismissed just now. Try again.'),
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
    kept: en((value: string) => `You entered: ${value} (kept)`),
    replaced: en((value: string) => `You entered: ${value} (replaced)`),
    replace: en('Replace details I already entered'),
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
  /** Why a reading failed, when the service did not say (the contract has no reason: gap 3). */
  failureReason: {
    unknown: en('the document could not be processed'),
    timeout: en('it took too long'),
    unavailable: en('the service is not available now'),
    refused: en('the file is not ready to be read'),
    missing: en('the file is no longer attached'),
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
};

export const REGISTRY_COPY = english(COPY.registry);
export const EXTRACTION_COPY = english(COPY.extraction);
export const FAILURE_REASONS = english(COPY.failureReason);
export const FIELD_LABELS = english(COPY.field);
export const SUGGESTION_COPY = english(COPY.suggestion);
export const KRA_COPY = english(COPY.kra);
export const COMPLIANCE_WORDS: Record<string, string> = english(COPY.complianceStatus);
export const ROSTER_HINT = COPY.roster.hint.en;
