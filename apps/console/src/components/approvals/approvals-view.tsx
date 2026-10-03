import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  Icon,
  type IconProps,
  Skeleton,
  TabsCount,
  TabsLink,
  TabsNav,
  daysBetween,
  useToast,
} from '@adili/ui';
import { JusticeScale01Icon, LockIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';

import type { ApprovalsLoad } from '../../server/approvals';
import { getSupervisors, reassignToSupervisor } from '../../server/approvals';
import type { ApprovalCounts, InboxItem, InboxKind } from '../../server/approvals.server';
import { INBOX_KINDS } from '../../server/approvals.server';
import { approveCaseDetermination, returnCaseDetermination } from '../../server/determinations';
import type { DeterminationRefusal, DeterminationResult } from '../../server/determinations.server';
import type { Assignee, Determination } from '../../server/review/types';
import { CursorPager } from '../cursor-pager';
import { DialogFailure, DialogHeading, type FailureText } from '../determination/dialog-parts';
import { LoadError } from '../load-error';
import { Page, PageHead } from '../page';
import {
  ApproveDeterminationDialog,
  DeterminationApproval,
  type DeterminationApprovalItem,
  ReturnDeterminationDialog,
} from './determination-approval';
import { messages as t } from './messages';
import { ReassignDialog, type ReassignTarget } from './reassign-dialog';

/**
 * The supervisors' approvals inbox (spec 08 FE-3; S1, S14): a tab per kind of approval with its
 * count, how long the approvals have waited, and each kind's cards, oldest first. Each kind is an
 * entry of `KINDS` and a case of `ApprovalItemCard`: the ladder's actions (#205) and referrals
 * (#211) arrive as two more. Approve, return and reassign answer in place; a separation-of-duties
 * refusal or a decision someone else made first opens a dialog that says so.
 */

/** Each kind's tab. */
const KINDS: Record<InboxKind, { label: string; icon: IconProps['icon'] }> = {
  determination: { label: t.tabs.determination, icon: JusticeScale01Icon },
};

export interface ApprovalsPaging {
  range: { from: number; to: number } | null;
  hasPrevious: boolean;
  onPrevious: () => void;
  onNext: (() => void) | null;
}

export interface ApprovalsViewProps {
  kind: InboxKind;
  /** Null while the first page loads. */
  load: ApprovalsLoad | null;
  viewer: Assignee;
  slug: string;
  paging: ApprovalsPaging | null;
  /** A fresh Idempotency-Key per approval; tests fix it. */
  newKey?: () => string;
}

/** An open refusal or conflict dialog. */
type Notice =
  | { kind: 'refused'; reason: 'proposer' | 'reviewer-of-record' | 'role'; target: ReassignTarget }
  | { kind: 'decided' };

/**
 * Runs the handler for the item's kind. With one kind shown, TypeScript reads `use[item.kind]`
 * as that kind's handler; each kind added makes it a union, and the call needs a cast to
 * `(item: InboxItem) => R` here.
 */
function byKind<R>(
  item: InboxItem,
  use: { [K in InboxKind]: (item: Extract<InboxItem, { kind: K }>) => R },
): R {
  return use[item.kind](item);
}

/** What an approval is about, in a dialog's subtitle, by its kind. */
function subjectOf(item: InboxItem): string {
  return byKind(item, {
    determination: (each) => `${each.summary.caseReference} · ${each.summary.declarantName}`,
  });
}

function reassignTarget(item: InboxItem): ReassignTarget {
  return {
    kind: item.kind,
    subjectId: item.subjectId,
    subject: subjectOf(item),
    proposer: item.proposer,
    current: item.reassignedTo,
  };
}

export function ApprovalsView({
  kind,
  load,
  viewer,
  slug,
  paging,
  newKey = () => crypto.randomUUID(),
}: ApprovalsViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [approving, setApproving] = useState<DeterminationApprovalItem | null>(null);
  const [returning, setReturning] = useState<DeterminationApprovalItem | null>(null);
  const [reassigning, setReassigning] = useState<ReassignTarget | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const approvalKey = useRef<{ subjectId: string; key: string } | null>(null);

  // A string, so comparing tabs with it stays a comparison once there is more than one kind.
  const shownKind: string = kind;
  const page = load?.ok ? load.data : null;
  const counts = page?.counts ?? null;
  const now = load ? Date.parse(load.now) : null;
  const total = counts ? INBOX_KINDS.reduce((sum, each) => sum + counts.byKind[each], 0) : null;
  // The inbox is oldest first: the first page's first card has waited longest.
  const oldest =
    page && now !== null && !paging?.hasPrevious && page.items[0]
      ? daysBetween(page.items[0].proposedAt, new Date(now).toISOString())
      : null;

  const loadSupervisors = useCallback(() => getSupervisors({ data: { slug } }), [slug]);

  /**
   * Settles a decision: a refusal by the rule opens the dialog that explains it, a decision made
   * first by someone else opens "Already decided"; either refreshes the list. Resolves to a
   * failure to show in the open dialog, or null when handled.
   */
  async function settle(
    item: DeterminationApprovalItem,
    result: DeterminationResult<Determination>,
    success: (data: Determination) => string,
  ): Promise<FailureText | null> {
    if (result.ok) {
      setApproving(null);
      setReturning(null);
      toast({ title: success(result.data) });
      await router.invalidate();
      return null;
    }
    if (result.refusal) {
      setApproving(null);
      setReturning(null);
      setNotice(noticeOf(result.refusal, item));
      await router.invalidate();
      return null;
    }
    if (result.error.kind === 'unauthenticated') return { title: t.toasts.sessionEnded };
    return { title: t.toasts.failed };
  }

  async function approve(item: DeterminationApprovalItem): Promise<FailureText | null> {
    // One key per approval, reused on retry after a failure, so a retry cannot approve twice.
    if (approvalKey.current?.subjectId !== item.subjectId) {
      approvalKey.current = { subjectId: item.subjectId, key: newKey() };
    }
    const result = await approveCaseDetermination({
      data: { determinationId: item.subjectId, idempotencyKey: approvalKey.current.key },
    });
    if (result.ok || result.refusal) approvalKey.current = null;
    return settle(item, result, (data) => t.toasts.approved(data.reference));
  }

  async function returnTo(
    item: DeterminationApprovalItem,
    reason: string,
  ): Promise<FailureText | null> {
    const result = await returnCaseDetermination({
      data: { determinationId: item.subjectId, reason },
    });
    return settle(item, result, () => t.toasts.returned);
  }

  async function reassign(target: ReassignTarget, to: Assignee): Promise<FailureText | null> {
    const result = await reassignToSupervisor({
      data: { kind: target.kind, subjectId: target.subjectId, toSupervisor: to.subject },
    });
    if (result.ok) {
      setReassigning(null);
      toast({ title: t.toasts.reassigned(result.data.reassignedTo.name) });
      await router.invalidate();
      return null;
    }
    if (result.error.kind === 'problem' && result.error.problem.status === 409) {
      setReassigning(null);
      setNotice({ kind: 'decided' });
      await router.invalidate();
      return null;
    }
    if (result.error.kind === 'unauthenticated') return { title: t.toasts.sessionEnded };
    return { title: t.toasts.failed };
  }

  return (
    <Page>
      <PageHead title={t.title}>
        {total !== null ? (
          <p className="mt-1 text-sm text-muted-foreground">{t.summary(total, oldest)}</p>
        ) : null}
      </PageHead>

      <TabsNav aria-label={t.tabsLabel} className="mb-4">
        {INBOX_KINDS.map((each) => (
          <TabsLink key={each} asChild current={each === shownKind}>
            <Link to="/approvals" search={{ kind: each }}>
              <Icon icon={KINDS[each].icon} className="size-4" />
              {KINDS[each].label}
              {counts ? <TabsCount>{counts.byKind[each]}</TabsCount> : null}
            </Link>
          </TabsLink>
        ))}
      </TabsNav>

      {counts && total ? <AgeBands counts={counts} /> : null}

      {load === null ? (
        <ApprovalsSkeleton />
      ) : !load.ok ? (
        <Card className="p-5">
          <LoadError
            title={t.loadFailed.title}
            detail={t.loadFailed.body}
            retryLabel={t.loadFailed.retry}
          />
        </Card>
      ) : load.data.items.length === 0 ? (
        <Card className="p-0 sm:p-0">
          <EmptyState
            icon={<Icon icon={Tick02Icon} />}
            title={t.emptyTitle}
            description={t.emptyBody}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          <ul className="grid gap-3" aria-label={KINDS[kind].label}>
            {load.data.items.map((item) => (
              <li key={item.subjectId}>
                <ApprovalItemCard
                  item={item}
                  viewer={viewer}
                  now={Date.parse(load.now)}
                  onApprove={() => {
                    setApproving(item);
                  }}
                  onReturn={() => {
                    setReturning(item);
                  }}
                  onReassign={() => {
                    setReassigning(reassignTarget(item));
                  }}
                />
              </li>
            ))}
          </ul>
          {paging && (paging.hasPrevious || paging.onNext) ? (
            <Card className="overflow-hidden p-0 sm:p-0">
              <CursorPager
                labels={t.pager}
                range={paging.range}
                rows={load.data.items.length}
                hasPrevious={paging.hasPrevious}
                hasNext={paging.onNext !== null}
                onPrevious={paging.onPrevious}
                onNext={() => paging.onNext?.()}
              />
            </Card>
          ) : null}
        </div>
      )}

      <ApproveDeterminationDialog
        item={approving}
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
        onConfirm={approve}
      />
      <ReturnDeterminationDialog
        item={returning}
        onOpenChange={(open) => {
          if (!open) setReturning(null);
        }}
        onConfirm={returnTo}
      />
      <ReassignDialog
        key={reassigning?.subjectId ?? 'closed'}
        target={reassigning}
        onOpenChange={(open) => {
          if (!open) setReassigning(null);
        }}
        loadSupervisors={loadSupervisors}
        onConfirm={reassign}
      />
      <NoticeDialog
        notice={notice}
        onClose={() => {
          setNotice(null);
        }}
        onReassign={(target) => {
          setNotice(null);
          setReassigning(target);
        }}
      />
    </Page>
  );
}

function noticeOf(refusal: DeterminationRefusal, item: InboxItem): Notice {
  if (refusal.kind === 'separation-of-duties') {
    return { kind: 'refused', reason: refusal.reason, target: reassignTarget(item) };
  }
  if (refusal.kind === 'supervisor-required') {
    return { kind: 'refused', reason: 'role', target: reassignTarget(item) };
  }
  return { kind: 'decided' };
}

/** One approval's card, by its kind. */
function ApprovalItemCard({
  item,
  viewer,
  now,
  onApprove,
  onReturn,
  onReassign,
}: {
  item: InboxItem;
  viewer: Assignee;
  now: number;
  onApprove: () => void;
  onReturn: () => void;
  onReassign: () => void;
}) {
  return byKind(item, {
    determination: (each) => (
      <DeterminationApproval
        item={each}
        viewer={viewer}
        now={now}
        onApprove={onApprove}
        onReturn={onReturn}
        onReassign={onReassign}
      />
    ),
  });
}

/** How long the approvals have waited, across every kind (the service counts them so). */
function AgeBands({ counts }: { counts: ApprovalCounts }) {
  const bands = [
    { label: t.age.under7Days, count: counts.byAge.under7Days, tone: '' },
    { label: t.age.from7To30Days, count: counts.byAge.from7To30Days, tone: 'text-warning' },
    { label: t.age.over30Days, count: counts.byAge.over30Days, tone: 'text-destructive' },
  ];
  return (
    <dl
      aria-label={t.age.label}
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13.5px]"
    >
      <span aria-hidden="true" className="mr-1 text-muted-foreground">
        {t.age.label}
      </span>
      {bands.map((band) => (
        <div
          key={band.label}
          className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 shadow-control"
        >
          <dt className="text-secondary-foreground">{band.label}</dt>
          <dd
            className={band.count > 0 && band.tone ? `font-semibold ${band.tone}` : 'font-semibold'}
          >
            {band.count}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ApprovalsSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      {[0, 1, 2].map((each) => (
        <Card key={each} className="grid gap-3.5 p-4 sm:px-5 sm:py-[18px]">
          <div className="flex gap-3.5">
            <Skeleton className="size-[38px] rounded-lg" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />
        </Card>
      ))}
    </div>
  );
}

/** "You cannot approve this" (403) with Reassign, or "Already decided" (409). */
function NoticeDialog({
  notice,
  onClose,
  onReassign,
}: {
  notice: Notice | null;
  onClose: () => void;
  onReassign: (target: ReassignTarget) => void;
}) {
  return (
    <Dialog
      open={notice !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {notice ? (
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeading
            icon={LockIcon}
            tone="destructive"
            title={notice.kind === 'refused' ? t.refused.title : t.decided.title}
          />
          <DialogBody className="gap-4">
            <DialogFailure
              failure={
                notice.kind === 'refused'
                  ? {
                      title: t.refused[notice.reason],
                      problem:
                        notice.reason === 'role'
                          ? '403 supervisor-required'
                          : '403 separation-of-duties',
                    }
                  : { title: t.decided.body, problem: '409 not-proposed' }
              }
            />
            <p className="text-sm text-secondary-foreground">
              {notice.kind === 'refused' ? t.refused.after : t.decided.after}
            </p>
          </DialogBody>
          <DialogFooter>
            {notice.kind === 'refused' && notice.reason !== 'role' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onReassign(notice.target);
                }}
              >
                {t.reassign}
              </Button>
            ) : null}
            <Button onClick={onClose}>
              {notice.kind === 'refused' ? t.refused.ok : t.decided.ok}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
