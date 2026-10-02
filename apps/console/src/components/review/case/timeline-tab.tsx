import { EmptyState, Icon, Timeline } from '@adili/ui';
import { Clock01Icon } from '@hugeicons/core-free-icons';

import { CASE_COPY } from '../../../review-case/messages';
import { timelineIcon } from '../../../review-case/view';
import type { TimelineEntry } from '../../../server/review/types';

/**
 * The Timeline tab (spec 07a FE-3): the case's events, newest first by day, each with what
 * happened (the review service's words), the time and who acted ("System" for the workflow).
 */
export function TimelineTab({ entries, now }: { entries: readonly TimelineEntry[]; now: number }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={Clock01Icon} />}
        title={CASE_COPY.timeline.emptyTitle}
        description={CASE_COPY.timeline.emptyBody}
      />
    );
  }
  return (
    <Timeline
      label={CASE_COPY.timeline.label}
      now={now}
      entries={entries.map((entry) => ({
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        title: entry.summary,
        actor: entry.actor?.name ?? null,
        ...timelineIcon(entry.kind),
      }))}
    />
  );
}
