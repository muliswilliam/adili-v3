import { Badge, cn, EmptyState, focusRingInset, Icon } from '@adili/ui';
import { Message01Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { CASE_COPY } from '../../../review-case/messages';
import type { Clarification } from '../../../server/review/types';
import { StatusBadge } from '../clarification-detail';

const copy = CASE_COPY.clarifications;

/** "Issued 3 Sep 2026 · responded 20 Sep 2026 · resolved 22 Sep 2026", or the draft's line. */
export function clarificationLine(clarification: Clarification): string {
  if (!clarification.issuedAt) return '';
  const parts = [copy.issued(clarification.issuedAt)];
  if (clarification.respondedAt) parts.push(copy.responded(clarification.respondedAt));
  else if (clarification.dueAt) parts.push(copy.due(clarification.dueAt));
  if (clarification.resolvedAt) parts.push(copy.resolved(clarification.resolvedAt));
  return parts.join(' · ');
}

/**
 * The Clarifications tab: the case's clarifications, each linking to its detail. The composer
 * and "New clarification" (spec 07a FE-4, #170) mount here.
 */
export function ClarificationsTab({
  caseId,
  clarifications,
}: {
  caseId: string;
  clarifications: readonly Clarification[];
}) {
  if (clarifications.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={Message01Icon} />}
        title={copy.emptyTitle}
        description={copy.emptyBody}
      />
    );
  }
  return (
    <ul className="overflow-hidden rounded-xl bg-card shadow-card">
      {clarifications.map((clarification) => (
        <li key={clarification.id} className="border-t first:border-t-0">
          <Link
            to="/review/cases/$caseId/clarifications/$clarificationId"
            params={{ caseId, clarificationId: clarification.id }}
            className={cn(
              focusRingInset,
              'grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3 hover:bg-muted/50',
            )}
          >
            <span className="grid size-8 place-items-center rounded-tile bg-muted text-secondary-foreground">
              <Icon icon={clarification.status === 'draft' ? PencilEdit02Icon : Message01Icon} />
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[13px] font-semibold">
                {clarification.reference ?? copy.draft}
              </span>
              <span className="block text-[13px] text-muted-foreground">
                {clarificationLine(clarification)}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <StatusBadge status={clarification.status} />
              {clarification.responseLate ? <Badge variant="warning">{copy.late}</Badge> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
