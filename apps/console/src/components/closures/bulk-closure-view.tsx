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

import { CLOSURE_TYPES, closureFilter, type ClosureSearch } from '../../closures/search';
import type { BulkApprovalResult, ClosureFilter, ClosureSummary } from '../../server/closures';
import { problemStatus, type ServiceError, type ServiceResult } from '../../server/service-call';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { en as m } from './messages';
import { CHUNK_SIZE, type BulkApproval, useBulkApproval } from './use-bulk-approval';

const ALL = 'all';

const TILES = 'grid grid-cols-1 gap-3 @min-[640px]:grid-cols-3';

export interface BulkClosureViewProps {
  /** The counts for `search`; null while they load. */
  summary: ServiceResult<ClosureSummary> | null;
  search: ClosureSearch;
  onSearchChange: (next: ClosureSearch) => void;
  /** Cycle years to choose from, newest first. */
  cycles: readonly number[];
  /** Approve the filters' proposals under the key. */
  approve: (
    idempotencyKey: string,
    filter: ClosureFilter,
  ) => Promise<ServiceResult<BulkApprovalResult>>;
  /** Read the counts for the filters again, while a run is under way. */
  readSummary: (filter: ClosureFilter) => Promise<ServiceResult<ClosureSummary>>;
  /** Now, for whether the clarification window has closed (`useToday`). */
  today: number;
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
  const { summary, search } = props;
  const router = useRouter();
  const bulk = useBulkApproval({
    filter: closureFilter(search),
    approve: props.approve,
    readSummary: props.readSummary,
  });
  const [confirming, setConfirming] = useState(false);

  if (isSupervisorRequired(summary)) {
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
  // What this supervisor can approve: the waiting proposals less those left for another one.
  const eligible = Math.max(0, (counts?.eligibleProposed ?? 0) - bulk.leftForOthers);
  const backToBatch = () => {
    bulk.reset();
    void router.invalidate();
  };

  return (
    <Page>
      <PageHead title={m.title} />
      {summary && !summary.ok ? (
        <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
      ) : counts === null ? (
        <BatchSkeleton />
      ) : (
        <Card className="@container p-5 sm:p-5">
          <BatchSelector
            filters={
              <FilterFields
                search={search}
                onSearchChange={props.onSearchChange}
                cycles={props.cycles}
              />
            }
            counts={swept ? <Counts summary={counts} approvedByRun={run?.approved ?? 0} /> : null}
            phase={phase}
            eligible={eligible}
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
              pendingDescription:
                counts.windowClosedAt !== null && Date.parse(counts.windowClosedAt) <= props.today
                  ? () => m.pendingSweep
                  : m.pendingDescription,
              ...(bulk.leftForOthers > 0
                ? { emptyDescription: m.leftForOthers(formatNumber(bulk.leftForOthers)) }
                : {}),
            }}
          />
          <Help summary={counts} />
        </Card>
      )}
      {counts ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          count={eligible}
          search={search}
          onConfirm={() => {
            setConfirming(false);
            bulk.start(counts, eligible);
          }}
        />
      ) : null}
    </Page>
  );
}

/** The review service's refusal of a reviewer: 403 `supervisor-required`. */
function isSupervisorRequired(summary: ServiceResult<ClosureSummary> | null): boolean {
  if (problemStatus(summary) !== 403 || !summary || summary.ok) return false;
  const { error } = summary;
  return (
    error.kind === 'problem' &&
    'code' in error.problem &&
    error.problem.code === 'supervisor-required'
  );
}

function phaseOf(bulk: BulkApproval, swept: boolean): BatchPhase {
  if (bulk.run.status === 'idle') return swept ? 'ready' : 'pending';
  return bulk.run.status;
}

function stoppedReason(error: ServiceError): string {
  if (error.kind === 'problem') return error.problem.detail ?? `${error.problem.title}.`;
  return m.stoppedUnavailable;
}

/** Cycle, type, the fixed band and (for now) every reporting entity, laid out by BatchSelector. */
function FilterFields({
  search,
  onSearchChange,
  cycles,
}: Pick<BulkClosureViewProps, 'search' | 'onSearchChange' | 'cycles'>) {
  return (
    <>
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
    </>
  );
}

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

/** The batch card while its counts load, the size of a loaded one. */
function BatchSkeleton() {
  return (
    <Card aria-busy="true" className="@container grid gap-4 p-5 sm:p-5">
      <div className="grid grid-cols-1 gap-3 @min-[600px]:grid-cols-2 @min-[1000px]:grid-cols-4">
        {[0, 1, 2, 3].map((each) => (
          <Skeleton key={each} className="h-[68px] rounded-lg" />
        ))}
      </div>
      <div className={TILES}>
        <StatTileSkeleton lines={1} />
        <StatTileSkeleton lines={1} />
        <StatTileSkeleton lines={1} />
      </div>
      <Skeleton className="h-[52px] w-full rounded-lg" />
    </Card>
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
              {m.confirmFilters(
                search.cycle,
                search.type ? m.types[search.type] : m.typeAll,
                m.entityAll,
              )}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="gap-4">
          <p className="text-[15px]">{m.confirmBody}</p>
          <ApprovalConsequences
            heading={m.consequences}
            headingLevel={3}
            items={[
              {
                icon: HashtagIcon,
                title: m.allocated(n),
                detail: m.allocatedDetail(formatNumber(CHUNK_SIZE)),
              },
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
