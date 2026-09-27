import type { RosterSummary } from '../../server/directory/client';
import type { NavCounts } from '../shell/console-shell';
import { messages as m } from './messages';

/** The Roster sidebar entry's count: officers flagged as absent, when the summary is known. */
export function rosterNavCounts(
  roster: Pick<RosterSummary, 'flagged'> | null | undefined,
): NavCounts {
  if (!roster || roster.flagged <= 0) return {};
  return { '/roster': { count: roster.flagged, label: m.navFlagged(roster.flagged) } };
}
