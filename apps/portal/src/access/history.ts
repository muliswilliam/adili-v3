import type { RegisterEntry } from '@adili/ui';

import type { AccessHistoryEntry, DeclarantNotice } from '../server/access/types';
import { HISTORY_COPY as COPY } from './history-copy';
import { OUTCOMES, STANCES } from './notice-copy';

/**
 * "Who accessed my declaration" (spec 10 FE-4, S12) as the declarant reads it: each register
 * entry in their words, the filters and the pages. Pure.
 */

/** What an entry is about, for the filters. */
export type HistoryGroup = 'form-k' | 'copy';
export type HistoryFilter = 'all' | HistoryGroup;

export const HISTORY_FILTERS: HistoryFilter[] = ['all', 'form-k', 'copy'];
export const HISTORY_PAGE_SIZE = 10;

/**
 * Kinds the declarant never sees (S12): steps before they were notified, and a request closed
 * before it reached them. The service leaves them out already; this is a second fence.
 */
const HIDDEN: ReadonlySet<AccessHistoryEntry['kind']> = new Set([
  'received',
  'verified',
  'cannot-identify',
]);

export function visibleEntries(entries: AccessHistoryEntry[]): AccessHistoryEntry[] {
  return entries.filter((entry) => !HIDDEN.has(entry.kind));
}

export function groupOf(entry: AccessHistoryEntry): HistoryGroup {
  switch (entry.subjectKind) {
    case 'access-request':
      return 'form-k';
    case 'self-access':
      return 'copy';
  }
}

export function countByFilter(entries: AccessHistoryEntry[]): Record<HistoryFilter, number> {
  const counts: Record<HistoryFilter, number> = {
    all: entries.length,
    'form-k': 0,
    copy: 0,
  };
  for (const entry of entries) counts[groupOf(entry)] += 1;
  return counts;
}

export function filterEntries(
  entries: AccessHistoryEntry[],
  filter: HistoryFilter,
): AccessHistoryEntry[] {
  return filter === 'all' ? entries : entries.filter((entry) => groupOf(entry) === filter);
}

/** The page clamped to the pages there are, and its entries. */
export function pageOfEntries<T>(entries: T[], page: number, pageSize = HISTORY_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const shown = Math.min(Math.max(1, page), pages);
  return { page: shown, entries: entries.slice((shown - 1) * pageSize, shown * pageSize) };
}

/**
 * Whether this `representations` entry is the declarant's first response on its request (the
 * service records each save): later ones read as edits.
 */
function isFirstResponse(entry: AccessHistoryEntry, all: AccessHistoryEntry[]): boolean {
  return !all.some(
    (other) =>
      other.kind === 'representations' &&
      other.subjectId === entry.subjectId &&
      Date.parse(other.at) < Date.parse(entry.at),
  );
}

/**
 * One entry in the declarant's words, as `RegisterList` / `RegisterTimeline` show it: who did
 * what, and who acted as far as the declarant may know (staff only by their role). `notices` gives the stance of their response; `all` is
 * every entry, to tell a first response from an edit.
 */
export function toRegisterEntry(
  entry: AccessHistoryEntry,
  all: AccessHistoryEntry[],
  notices: DeclarantNotice[],
): RegisterEntry {
  const commission = entry.commission.name;
  const who = entry.requester ?? COPY.someone;
  // A grant that found nothing in its scope delivered the nil letter, not a package (decision 1).
  const nilLetter = entry.packageKind === 'nil-letter';
  const base = { id: entry.id, kind: entry.kind, at: entry.at, reference: entry.reference };
  switch (entry.kind) {
    case 'notified':
      return {
        ...base,
        title: COPY.askedToSee(who),
        actor: entry.inWriting ? COPY.notifiedInWriting(commission) : COPY.notifiedBy(commission),
        tone: 'brand',
      };
    case 'representations': {
      const actor = entry.inWriting ? COPY.youInWriting : COPY.you;
      if (!isFirstResponse(entry, all)) return { ...base, title: COPY.edited, actor };
      const notice = notices.find((each) => each.requestId === entry.subjectId);
      const stance = notice?.kind === 'form-k' ? notice.representations?.stance : undefined;
      return {
        ...base,
        title: stance ? STANCES[stance].done.en : COPY.responded,
        actor,
      };
    }
    case 'decided':
      return entry.outcome
        ? {
            ...base,
            outcome: entry.outcome,
            title: COPY.decided(commission, OUTCOMES[entry.outcome].verb.en),
            actor: COPY.officerOf(commission),
          }
        : { ...base, actor: COPY.officerOf(commission) };
    case 'decision-notified':
      return {
        ...base,
        title: COPY.toldDecisionInWriting,
        actor: COPY.officerOf(commission),
        tone: 'default',
      };
    case 'package-issued':
      return {
        ...base,
        title: nilLetter ? COPY.nilLetterIssued(who) : COPY.packageIssued(who),
        actor: COPY.watermarked,
        tone: 'default',
      };
    case 'downloaded':
      return {
        ...base,
        title: (nilLetter ? COPY.downloadedNilLetter : COPY.downloaded)(entry.actor ?? who),
        actor: COPY.applicant,
      };
    case 'expired':
      return { ...base, title: COPY.expired, actor: null, tone: 'default' };
    case 'withdrawn':
      return { ...base, title: COPY.withdrew(entry.actor ?? who), actor: COPY.applicant };
    case 'self-access': {
      const copy = entry.certifiedCopy;
      if (copy?.representativeName) {
        return {
          ...base,
          title: COPY.representativeCopy(copy.representativeName),
          actor: COPY.representative,
          tone: 'default',
        };
      }
      return {
        ...base,
        title: COPY.youCopy,
        actor: copy ? COPY.youCopyActor(copy.version) : COPY.you,
        tone: 'default',
      };
    }
    default:
      return { ...base, actor: null };
  }
}

/** Every entry about the same request or copy as `entry`. */
export function entriesOfSubject(
  entry: AccessHistoryEntry,
  all: AccessHistoryEntry[],
): AccessHistoryEntry[] {
  return all.filter((other) => other.subjectId === entry.subjectId);
}
