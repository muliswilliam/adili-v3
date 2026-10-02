import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  IconTile,
  Tooltip,
  cn,
  focusRingInset,
} from '@adili/ui';
import { Message01Icon, PencilEdit02Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { listLine, newClarificationBlock } from '../../clarification/list';
import type { CaseListItem, Clarification } from '../../server/review/types';
import { StatusBadge } from './status-badge';
import { messages } from './composer/messages';

const t = messages.list;

/**
 * The Clarifications tab of the case view (spec 07a FE-4): the case's clarifications newest
 * first, each linking to its detail, and "New clarification" for the officer holding the case
 * while the six-month window is open (disabled with the reason otherwise). Opening the composer
 * is the host's: pass `onNew`. Ready to mount in the case view's side tabs (#164).
 */
export function CaseClarifications({
  reviewCase,
  clarifications,
  subject,
  now,
  onNew,
}: {
  reviewCase: CaseListItem;
  /** `CaseDetail.clarifications`, newest first. */
  clarifications: readonly Clarification[];
  /** The viewer's subject, to tell whether they hold the case. */
  subject: string;
  now: string;
  /** Opens the composer for a new clarification. */
  onNew: () => void;
}) {
  const blocked = newClarificationBlock(reviewCase, subject, now);
  const button = (
    <Button size="sm" disabled={blocked !== null} onClick={onNew}>
      <Icon icon={PlusSignIcon} />
      {t.newClarification}
    </Button>
  );
  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="min-w-[180px] flex-1 text-sm text-muted-foreground">
          {blocked ?? t.windowOpen(reviewCase.windowEndsAt)}
        </p>
        {blocked ? (
          <Tooltip content={blocked}>
            {/* A disabled button takes no pointer or focus; the wrapper shows the reason. */}
            <span tabIndex={0} className="rounded-md">
              {button}
            </span>
          </Tooltip>
        ) : (
          button
        )}
      </div>
      {clarifications.length > 0 ? (
        <Card className="overflow-hidden p-0 sm:p-0">
          <ul aria-label={t.listLabel}>
            {clarifications.map((clarification) => (
              <li key={clarification.id} className="border-b last:border-b-0">
                <Link
                  to="/review/cases/$caseId/clarifications/$clarificationId"
                  params={{ caseId: reviewCase.id, clarificationId: clarification.id }}
                  className={cn(
                    'flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-muted/50',
                    focusRingInset,
                  )}
                >
                  <IconTile>
                    <Icon
                      icon={clarification.status === 'draft' ? PencilEdit02Icon : Message01Icon}
                    />
                  </IconTile>
                  <span className="grid min-w-0 flex-1 gap-px">
                    <span className="font-mono text-[13px] font-medium">
                      {clarification.reference ?? t.draftReference}
                    </span>
                    <span className="text-[13.5px] leading-[1.4] text-muted-foreground">
                      {listLine(clarification)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <StatusBadge status={clarification.status} />
                    {clarification.responseLate ? <Badge variant="warning">{t.late}</Badge> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState
          icon={<Icon icon={Message01Icon} />}
          title={t.emptyTitle}
          description={t.emptyText}
        />
      )}
    </div>
  );
}
