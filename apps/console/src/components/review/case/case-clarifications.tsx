import { Badge, cn, EmptyState, focusRing, formatDate, Icon, plural } from '@adili/ui';
import { Message01Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { Clarification } from '../../../server/review/types';
import { StatusBadge } from '../clarification-detail';

/**
 * The Clarifications tab of the case view: the case's clarifications, newest first, each opening
 * its detail page, under a line saying until when the window to request clarification is open.
 *
 * Slot for #170: `action` is where the clarification composer mounts its "New clarification"
 * button (and the drawer it opens); this tab builds no composer of its own.
 */
export function CaseClarifications({
  caseId,
  clarifications,
  line,
  action,
}: {
  caseId: string;
  clarifications: Clarification[];
  /** "Window open until 12 Oct 2026", or why no clarification can be issued. */
  line: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="min-w-[180px] flex-1 text-[13px] text-muted-foreground">{line}</p>
        {action}
      </div>
      {clarifications.length > 0 ? (
        <ul className="overflow-hidden rounded-xl shadow-card" aria-label="Clarifications">
          {clarifications.map((clarification) => (
            <li key={clarification.id} className="border-b last:border-b-0">
              <Link
                to="/review/cases/$caseId/clarifications/$clarificationId"
                params={{ caseId, clarificationId: clarification.id }}
                className={cn(
                  focusRing,
                  'flex items-center gap-3 bg-card px-3.5 py-3 hover:bg-muted/60',
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-muted text-secondary-foreground">
                  <Icon
                    icon={clarification.status === 'draft' ? PencilEdit02Icon : Message01Icon}
                    className="size-4"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[13px] font-semibold">
                    {clarification.reference ?? 'Draft (no reference yet)'}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {datesOf(clarification)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge status={clarification.status} />
                  {clarification.responseLate ? <Badge variant="warning">Late</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Icon icon={Message01Icon} />}
          title="No clarifications yet"
          description="None issued for this case."
        />
      )}
    </div>
  );
}

function datesOf(clarification: Clarification): string {
  if (clarification.status === 'draft' || !clarification.issuedAt) {
    return `Draft · ${plural(clarification.items.length, 'item')}`;
  }
  const bits = [`Issued ${formatDate(clarification.issuedAt)}`];
  if (clarification.status === 'withdrawn') bits.push('withdrawn');
  else if (clarification.respondedAt)
    bits.push(`responded ${formatDate(clarification.respondedAt)}`);
  else if (clarification.dueAt) bits.push(`due ${formatDate(clarification.dueAt)}`);
  if (clarification.resolvedAt) bits.push(`resolved ${formatDate(clarification.resolvedAt)}`);
  return bits.join(' · ');
}
