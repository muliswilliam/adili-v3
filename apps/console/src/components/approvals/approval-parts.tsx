import { Button, Icon } from '@adili/ui';
import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons';

import type { InboxItem } from '../../server/approvals.server';
import type { Assignee } from '../../server/review/types';
import { problemLabel } from '../../server/service-call';
import type { ApprovalNotice } from './kind';
import { messages as m } from './messages';

/**
 * A card's actions every kind shares: Reassign when the viewer cannot decide it, and whom it was
 * reassigned to.
 */
export function ReassignActions({
  item,
  viewer,
  onReassign,
}: {
  item: InboxItem;
  viewer: Assignee;
  onReassign: () => void;
}) {
  const reassigned = item.reassignedTo;
  return (
    <>
      {item.canApprove ? null : (
        <Button size="sm" variant="secondary" onClick={onReassign}>
          <Icon icon={ArrowDataTransferHorizontalIcon} />
          {m.reassign}
        </Button>
      )}
      {reassigned ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Icon icon={ArrowDataTransferHorizontalIcon} className="size-3.5" />
          {reassigned.subject === viewer.subject
            ? m.reassignedToYou
            : m.reassignedTo(reassigned.name)}
        </span>
      ) : null}
    </>
  );
}

/** "Already decided": someone decided the approval while the page was open (409 `not-proposed`). */
export function decidedNotice(): ApprovalNotice {
  return {
    title: m.decided.title,
    failure: { title: m.decided.body, problem: problemLabel(409, 'not-proposed') },
    after: m.decided.after,
    offerReassign: false,
  };
}

/** Who proposed an approval, by name, or the system. */
export function proposerName(item: InboxItem): string {
  return item.proposer?.name ?? m.system;
}
