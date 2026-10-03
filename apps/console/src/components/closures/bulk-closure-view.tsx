import {
  ApprovalConsequences,
  type BatchPhase,
  BatchSelector,
  Button,
  Card,
  cn,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  focusRing,
  formatDate,
  formatDateTime,
  formatNumber,
  FormField,
  Icon,
  IconTile,
  Select,
  SelectItem,
  Skeleton,
  StatTile,
  StatTileSkeleton,
  textLink,
} from '@adili/ui';
import {
  Archive02Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  File02Icon,
  HashtagIcon,
  HelpCircleIcon,
  Notification01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import { CLOSURE_TYPES, type ClosureSearch } from '../../closures/search';
import type { BulkApprovalResult, ClosureSummary } from '../../server/closures';
import { problemStatus, type ServiceResult } from '../../server/service-call';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { en as m } from './messages';
import { CHUNK_SIZE, type BulkApproval, useBulkApproval } from './use-bulk-approval';

const ALL = 'all';

export interface BulkClosureViewProps {
  /** The counts for `search`; null while they load. */
  summary: ServiceResult<ClosureSummary> | null;
  search: ClosureSearch;
  onSearchChange: (next: ClosureSearch) => void;
  /** Cycle years to choose from, newest first. */
  cycles: readonly number[];
  /** Approve the filters' proposals under the key. */
  approve: (idempotencyKey: string) => Promise<ServiceResult<BulkApprovalResult>>;
  /** Read the counts for the filters again, while a run is under way. */
  readSummary: () => Promise<ServiceResult<ClosureSummary>>;
}

/**
 * The bulk closure screen (spec 08 FE-4, `/approvals/bulk-closure`): a supervisor approves the
 * system's `compliant-no-issues` proposals of a cycle in batches. Filters (cycle and type in the
 * URL; the band is low only; the reporting entity is all of them for now), the eligible, sampled
 * and approved counts, and the batch: no proposals before the sweep, ready, nothing left, a
 * confirmation that says what approving does, chunks landing while it runs, the CMP range when
 * done, and a stopped run with Resume. A reviewer is told it is for supervisors.
 */
export function BulkClosureView(props: BulkClosureViewProps) {
  const { summary } = props;
  const router = useRouter();
  const bulk = useBulkApproval({ approve: props.approve, readSummary: props.readSummary });
  const [confirming, setConfirming] = useState(false);

  if (problemStatus(summary) === 403) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <NoAccess
          text={m.supervisorsOnly}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/review">{m.reviewQueue}</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const counts = summary?.ok ? summary.data : null;
  const swept = counts?.lastSweptAt != null;
  const phase = phaseOf(bulk, swept);
  const run = bulk.run.status === 'idle' ? null : bulk.run;
  const backToBatch = () => {
    bulk.reset();
    void router.invalidate();
  };

  return (
    <Page>
      <PageHead title={m.title} />
      <div className="grid gap-4">
        <Filters {...props} locked={phase === 'running'} />
        {summary && !summary.ok ? (
          <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
        ) : (
          <>
            {counts === null ? (
              <CountsSkeleton />
            ) : swept ? (
              <Counts summary={counts} approvedByRun={run?.approved ?? 0} />
            ) : null}
            <Card className="@container p-5 sm:p-5">
              {counts === null ? (
                <Skeleton className="h-[52px] w-full rounded-lg" />
              ) : (
                <BatchSelector
                  phase={phase}
                  eligible={counts.eligibleProposed}
                  excluded={counts.sampled}
                  chunkSize={CHUNK_SIZE}
                  windowClosesAt={counts.windowClosedAt}
                  progress={bulk.progress}
                  references={bulk.references}
                  skipped={run?.result?.skipped ?? 0}
                  stoppedReason={run?.error ? stoppedReason(run.error) : undefined}
                  onApprove={() => {
                    setConfirming(true);
                  }}
                  onResume={bulk.resume}
                  onStop={backToBatch}
                  onReset={backToBatch}
                  messages={{
                    pendingDescription: m.pendingDescription,
                  }}
                />
              )}
              <Help summary={counts} />
            </Card>
          </>
        )}
      </div>
      {counts ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          count={counts.eligibleProposed}
          search={props.search}
          onConfirm={() => {
            setConfirming(false);
            bulk.start(counts);
          }}
        />
      ) : null}
    </Page>
  );
}

function phaseOf(bulk: BulkApproval, swept: boolean): BatchPhase {
  switch (bulk.run.status) {
    case 'running':
      return 'running';
    case 'stopped':
      return 'stopped';
    case 'done':
      return 'done';
    case 'idle':
      return swept ? 'ready' : 'pending';
  }
}

function stoppedReason(
  error: NonNullable<Extract<BulkApproval['run'], { error: unknown }>['error']>,
) {
  if (error.kind === 'problem') return error.problem.detail ?? `${error.problem.title}.`;
  return m.stoppedUnavailable;
}

function Filters({
  search,
  onSearchChange,
  cycles,
  locked,
}: BulkClosureViewProps & { locked: boolean }) {
  return (
    <Card className="@container p-5 sm:p-5">
      <fieldset disabled={locked} className="min-w-0">
        <legend className="sr-only">{m.filters}</legend>
        <div className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2 @min-[1000px]:grid-cols-4">
          <FormField label={m.cycleLabel}>
            <Select
              value={String(search.cycle)}
              onValueChange={(value) => {
                onSearchChange({ ...search, cycle: Number(value) });
              }}
            >
              {cycles.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {m.cycleOption(year)}
                </SelectItem>
              ))}
            </Select>
          </FormField>
          <FormField label={m.typeLabel}>
            <Select
              value={search.type ?? ALL}
              onValueChange={(value) => {
                const type = CLOSURE_TYPES.find((each) => each === value);
                onSearchChange(type ? { ...search, type } : { cycle: search.cycle });
              }}
            >
              <SelectItem value={ALL}>{m.typeAll}</SelectItem>
              {CLOSURE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {m.types[type]}
                </SelectItem>
              ))}
            </Select>
          </FormField>
          <FormField label={m.bandLabel}>
            <Select value="low" disabled>
              <SelectItem value="low">{m.bandLow}</SelectItem>
            </Select>
          </FormField>
          <FormField label={m.entityLabel}>
            <Select value={ALL} disabled>
              <SelectItem value={ALL}>{m.entityAll}</SelectItem>
            </Select>
          </FormField>
        </div>
        {locked ? (
          <p className="mt-3 text-[13px] text-muted-foreground">{m.filtersLocked}</p>
        ) : null}
      </fieldset>
    </Card>
  );
}

const TILES = 'grid grid-cols-1 gap-3 min-[640px]:grid-cols-3';

/** Eligible, sampled (with the rate and the way to the queue) and approved, as the run moves. */
function Counts({ summary, approvedByRun }: { summary: ClosureSummary; approvedByRun: number }) {
  return (
    <div role="group" aria-label={m.countsLabel} className={TILES}>
      <StatTile
        label={m.eligible}
        value={Math.max(0, summary.eligibleProposed - approvedByRun)}
        marker={<Icon icon={Archive02Icon} />}
        description={m.eligibleDescription}
      />
      <StatTile
        label={m.sampled}
        value={summary.sampled}
        marker={<Icon icon={UserGroupIcon} />}
        description={
          <>
            {m.sampleRate(summary.sampleRate)} ·{' '}
            <Link to="/review" className={textLink}>
              {m.reviewQueue}
            </Link>
          </>
        }
      />
      <StatTile
        label={m.approved}
        value={summary.approved + approvedByRun}
        marker={<Icon icon={CheckmarkCircle02Icon} />}
        description={m.approvedDescription}
      />
    </div>
  );
}

function CountsSkeleton() {
  return (
    <div aria-busy="true" className={TILES}>
      <StatTileSkeleton lines={1} />
      <StatTileSkeleton lines={1} />
      <StatTileSkeleton lines={1} />
    </div>
  );
}

/** How cases are proposed and sampled, under the batch. */
function Help({ summary }: { summary: ClosureSummary | null }) {
  const window = summary?.windowClosedAt ? formatDate(summary.windowClosedAt) : null;
  return (
    <details className="group mt-4 rounded-lg shadow-control">
      <summary
        className={cn(
          focusRing,
          'flex cursor-pointer list-none items-center gap-2 rounded-lg px-3.5 py-3 text-[14.5px] font-medium [&::-webkit-details-marker]:hidden',
        )}
      >
        <Icon icon={HelpCircleIcon} className="size-4 text-secondary-foreground" />
        {m.helpTitle}
        <Icon
          icon={ArrowDown01Icon}
          className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="grid gap-2 border-t px-3.5 py-3 text-[13.5px] text-secondary-foreground">
        <p>{m.helpIntro}</p>
        <ul className="list-disc pl-5">
          {m.helpRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        {window ? (
          <p>{summary?.lastSweptAt ? m.helpWindow(window) : m.helpWindowCloses(window)}</p>
        ) : null}
        {summary ? (
          <p>
            <b className="font-semibold text-foreground">{m.helpSample(summary.sampleRate)}</b>{' '}
            {m.helpSampleBody}{' '}
            {summary.lastSweptAt
              ? m.helpSwept(formatDateTime(summary.lastSweptAt))
              : m.helpNotSwept}
          </p>
        ) : null}
        <p>
          <b className="font-semibold text-foreground">{m.helpLetters}</b> {m.helpLettersBody}
        </p>
      </div>
    </details>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  count,
  search,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  search: ClosureSearch;
  onConfirm: () => void;
}) {
  const n = formatNumber(count);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="flex-row items-start gap-3">
          <IconTile>
            <Icon icon={Archive02Icon} />
          </IconTile>
          <div className="grid min-w-0 gap-[3px]">
            <DialogTitle>{m.confirmTitle(n)}</DialogTitle>
            <DialogDescription>
              {m.confirmFilters(search.cycle, search.type ? m.types[search.type] : m.typeAll)}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="gap-4">
          <p className="text-[15px]">{m.confirmBody}</p>
          <ApprovalConsequences
            heading={m.consequences}
            headingLevel={3}
            items={[
              { icon: HashtagIcon, title: m.allocated(n), detail: m.allocatedDetail },
              { icon: CheckmarkCircle02Icon, title: m.determined },
              { icon: Notification01Icon, title: m.notified, detail: m.notifiedDetail },
              { icon: File02Icon, title: m.letters, detail: m.lettersDetail },
            ]}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{m.cancel}</Button>
          </DialogClose>
          <Button onClick={onConfirm}>{m.confirm(n)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
