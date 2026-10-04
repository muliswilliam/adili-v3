import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  Icon,
  Skeleton,
  TabsCount,
  TabsLink,
  TabsNav,
  useToast,
} from '@adili/ui';
import { LockIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { APPROVAL_KINDS, INBOX_KINDS, type InboxKind } from '../../approvals/kinds';
import type { ApprovalsLoad } from '../../server/approvals';
import { getSupervisors, reassignToSupervisor } from '../../server/approvals';
import type { ApprovalCounts, InboxItem } from '../../server/approvals.server';
import type { Assignee } from '../../server/review/types';
import { CursorPager } from '../cursor-pager';
import { DialogFailure, DialogHeading, type FailureText } from '../dialog-parts';
import { LoadError } from '../load-error';
import { Page, PageHead } from '../page';
import type { ApprovalNotice, Settled } from './kind';
import { decidedNotice } from './approval-parts';
import { KindApproval, KINDS, kindOf } from './kinds';
import { messages as t } from './messages';
import { ReassignDialog, type ReassignTarget } from './reassign-dialog';

/**
 * The supervisors' approvals inbox (spec 08 FE-3; S1, S14): a tab per kind of approval with its
 * count, how many approvals have waited how long, and the tab's cards, oldest first. Each kind's
 * card decides it with its own dialogs (`kinds.tsx`); the inbox reloads after each, shows the
 * kind's toast or refusal, and reassigns any kind to another supervisor.
 */

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
  /** A fresh Idempotency-Key per decision; tests fix it. */
  newKey?: () => string;
}

/** An open refusal or conflict dialog, and the approval it is about. */
interface OpenNotice {
  notice: ApprovalNotice;
  target: ReassignTarget;
}

function reassignTarget(item: InboxItem): ReassignTarget {
  return {
    kind: item.kind,
    subjectId: item.subjectId,
    subject: kindOf(item).subject(item),
    proposer: item.proposer,
    current: item.reassignedTo,
  };
}

const reassignFailure = (error: { kind: string }): FailureText => ({
  title: error.kind === 'unauthenticated' ? t.toasts.sessionEnded : t.toasts.failed,
});

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
  const [reassigning, setReassigning] = useState<ReassignTarget | null>(null);
  const [notice, setNotice] = useState<OpenNotice | null>(null);

  const page = load?.ok ? load.data : null;
  const counts = page?.counts ?? null;
  // Every kind, as the age bands count them (review counts ages across kinds).
  const total = counts ? APPROVAL_KINDS.reduce((sum, each) => sum + counts.byKind[each], 0) : null;

  const loadSupervisors = useCallback(() => getSupervisors({ data: { slug } }), [slug]);

  async function settled(item: InboxItem, outcome: Settled) {
    if (outcome.kind === 'decided') toast({ title: outcome.toast });
    else setNotice({ notice: outcome.notice, target: reassignTarget(item) });
    await router.invalidate();
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
    if (result.error.kind === 'problem' && result.error.problem.type === 'not-proposed') {
      setReassigning(null);
      setNotice({
        notice: decidedNotice(),
        target,
      });
      await router.invalidate();
      return null;
    }
    return reassignFailure(result.error);
  }

  return (
    <Page>
      <PageHead title={t.title}>
        {total !== null ? (
          <p className="mt-1 text-sm text-muted-foreground">{t.summary(total)}</p>
        ) : null}
      </PageHead>

      <TabsNav aria-label={t.tabsLabel} className="mb-4">
        {INBOX_KINDS.map((each) => {
          const { label, icon } = KINDS[each];
          return (
            <TabsLink key={each} asChild>
              <Link
                to="/approvals"
                search={{ kind: each }}
                activeOptions={{ includeSearch: true }}
                activeProps={{ 'aria-current': 'page' }}
              >
                <Icon icon={icon} className="size-4" />
                {label}
                {counts ? <TabsCount>{counts.byKind[each]}</TabsCount> : null}
              </Link>
            </TabsLink>
          );
        })}
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
                <KindApproval
                  item={item}
                  viewer={viewer}
                  now={Date.parse(load.now)}
                  newKey={newKey}
                  onReassign={() => {
                    setReassigning(reassignTarget(item));
                  }}
                  onSettled={(outcome) => settled(item, outcome)}
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
        open={notice}
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
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1"
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

/** A kind's refusal or conflict, with Reassign when the kind offers it. */
function NoticeDialog({
  open,
  onClose,
  onReassign,
}: {
  open: OpenNotice | null;
  onClose: () => void;
  onReassign: (target: ReassignTarget) => void;
}) {
  return (
    <Dialog
      open={open !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open ? (
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeading icon={LockIcon} tone="destructive" title={open.notice.title} />
          <DialogBody className="gap-4">
            <DialogFailure failure={open.notice.failure} />
            {open.notice.after ? (
              <p className="text-sm text-secondary-foreground">{open.notice.after}</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            {open.notice.offerReassign ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onReassign(open.target);
                }}
              >
                {t.reassign}
              </Button>
            ) : null}
            <Button onClick={onClose}>{t.notice.ok}</Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
