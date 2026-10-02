import { plural } from '@adili/ui';

import { en, english } from '../declaration/translatable';

/**
 * Words for "Who accessed my declaration" and certified copies (spec 10 FE-4, S12, S13). The
 * empty states are not given by the spec; they follow the prototype
 * (`declarant-profile.prototype.html`). English with an empty Swahili slot until the Swahili copy
 * is done.
 */

const TRANSPARENCY = {
  home: en('Home'),
  goHome: en('Go to Home'),
  sections: en('Transparency'),
  whoAccessedTab: en('Who accessed'),
  copiesTab: en('Certified copies'),
  tryAgain: en('Try again'),
  signIn: en('Sign in'),
};

export const TRANSPARENCY_COPY = english(TRANSPARENCY);

const HISTORY = {
  title: en('Who accessed my declaration'),
  listLabel: en('Who accessed my declaration'),
  filters: en('Show'),
  all: en('All'),
  formK: en('Access requests'),
  lea: en('Law enforcement'),
  copies: en('Certified copies'),
  entries: en('entries'),
  pagination: en('Pages of entries'),
  emptyTitle: en('No one has accessed your declaration'),
  emptyText: en('Requests, decisions, downloads and certified copies will show here.'),
  filterEmptyTitle: en('Nothing here'),
  filterEmptyText: en('No entries of this kind.'),
  showAll: en('Show all'),
  unavailableTitle: en('We could not load who accessed your declaration'),
  unavailableText: en('Check your connection and try again.'),
  waiting: en(
    (applicant: string, date: string) =>
      `${applicant} asked to see your declaration. Respond by ${date}.`,
  ),
  respond: en('Respond'),
  footNote: en('Entries cannot be changed.'),
  whatShows: en('What shows here'),
  whatShowsText: en(
    'Access requests show from when you were notified. Law-enforcement requests show once access is granted. Staff names are not shown.',
  ),

  // Entries, in the declarant's words.
  askedToSee: en((who: string) => `${who} asked to see your declaration`),
  notifiedBy: en((commission: string) => `Notified by ${commission}`),
  responded: en('You responded'),
  edited: en('You edited your response'),
  you: en('You'),
  decided: en((commission: string, verb: string) => `${commission} ${verb}`),
  officerOf: en((commission: string) => `Access officer, ${commission}`),
  agencyGranted: en((agency: string, verb: string) => `${agency} was ${verb}`),
  caseOf: en((caseReference: string) => `Case ${caseReference}`),
  packageIssued: en((who: string) => `Package issued to ${who}`),
  watermarked: en('Watermarked'),
  downloaded: en((who: string) => `${who} downloaded the package`),
  applicant: en('Applicant'),
  agency: en('Law-enforcement agency'),
  expired: en('Download period ended'),
  withdrew: en((who: string) => `${who} withdrew the request`),
  youCopy: en('You obtained a certified copy'),
  youCopyActor: en((version: number) => `You · version ${String(version)}`),
  representativeCopy: en((name: string) => `${name} obtained a certified copy for you`),
  representative: en('Your representative'),
  someone: en('Someone'),

  // Drawer
  accessRequest: en('Access request'),
  leaRequest: en('Law-enforcement request'),
  certifiedCopy: en('Certified copy'),
  applicantTerm: en('Applicant'),
  purpose: en('Purpose'),
  scopeAsked: en('Scope asked'),
  scopeGranted: en('Scope granted'),
  yourResponse: en('Your response'),
  dueBy: en((date: string) => `Due by ${date}`),
  none: en('None'),
  decision: en('Decision'),
  notYet: en('Not yet'),
  grounds: en('Grounds'),
  reasons: en('Reasons'),
  agencyTerm: en('Agency'),
  caseReference: en('Case reference'),
  outcome: en('Outcome'),
  grantedOn: en('Granted on'),
  notifiedOn: en('Notified on'),
  commission: en('Commission'),
  timeline: en('Timeline'),
  respondBy: en((date: string) => `Respond by ${date}`),
  openRequest: en('Open access request'),
  declaration: en('Declaration'),
  versionOf: en((version: number) => `Version ${String(version)}`),
  issued: en('Issued'),
  obtainedBy: en('Obtained by'),
  youOnline: en('You, on Adili Online'),
  representativeOf: en((name: string) => `${name}, your representative`),
  classification: en('Classification'),
  restricted: en('Restricted'),
  download: en('Download'),
};

export const HISTORY_COPY = english(HISTORY);

const COPIES = {
  title: en('Certified copies'),
  listLabel: en('Your submitted versions'),
  emptyTitle: en('No submitted declarations'),
  emptyText: en('Once you submit a declaration, you can get a certified copy of it here.'),
  unavailableTitle: en('We could not load your certified copies'),
  unavailableText: en('Check your connection and try again.'),
  versionLine: en((version: number) => `version ${String(version)}`),
  superseded: en('Superseded'),
  submitted: en((date: string) => `Submitted ${date}`),
  request: en('Request certified copy'),
  requestOf: en((label: string) => `Request certified copy of ${label}`),
  preparing: en('Preparing…'),
  preparingOf: en((label: string) => `Preparing the certified copy of ${label}.`),
  readyOf: en((label: string) => `The certified copy of ${label} is ready to download.`),
  failedOf: en((label: string) => `We could not prepare the certified copy of ${label}.`),
  download: en('Download'),
  copyName: en('Certified copy'),
  downloadOf: en((label: string) => `Download certified copy of ${label}`),
  tryAgain: en('Try again'),
  tryAgainOf: en((label: string) => `Try again: certified copy of ${label}`),
  certified: en((date: string) => `Certified ${date}`),
  failed: en('We could not prepare the copy. Try again.'),
  ready: en('Certified copy ready'),
  requestFailed: en('We could not ask for the copy. Try again in a few minutes.'),
  downloadFailed: en('We could not download the copy. Try again.'),
  footNote: en('Restricted, signed PDF. Each copy shows in Who accessed.'),
  about: en('About certified copies'),
  aboutText: en(
    'A certified copy is the version exactly as you submitted it, signed by your Commission. Anyone you give it to can check it with its QR code.',
  ),
  pagination: en('Pages of your submitted versions'),
  versions: en((n: number) => plural(n, 'version')),
};

export const COPIES_COPY = english(COPIES);
