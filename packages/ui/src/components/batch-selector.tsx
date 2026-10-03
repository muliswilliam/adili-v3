import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useState } from 'react';

import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format-number';
import { Button } from './button';
import { Icon } from './icon';
import { ProgressBar } from './progress-bar';
import { Spinner } from './spinner';

/**
 * Where a bulk approval stands. `ready`: the filters' eligible items wait for approval.
 * `running`: chunks are being approved. `done`: every chunk is approved. `stopped`: a chunk
 * failed; the chunks before it stay approved and the rest are unchanged.
 */
export type BatchPhase = 'ready' | 'running' | 'done' | 'stopped';

export const BATCH_PHASES: readonly BatchPhase[] = ['ready', 'running', 'done', 'stopped'];

/** A run's progress: `chunk` chunks of `chunks` approved, `approved` items of `total`. */
export interface BatchProgress {
  chunk: number;
  chunks: number;
  approved: number;
  total: number;
}

/** Counts reach the messages already formatted with thousands separators ("1,240"). */
export interface BatchSelectorMessages {
  /** The filter group's name for screen readers. Defaults to "Filters". */
  filters: string;
  filtersLocked: string;
  /** Defaults to "{count} closures ready". */
  ready: (count: string) => string;
  /** Defaults to "{excluded} sampled excluded · {chunks} chunks of {size}". */
  readyDetail: (excluded: string, chunks: string, size: string) => string;
  /** Defaults to "Approve {count}". */
  approve: (count: string) => string;
  emptyTitle: string;
  emptyDescription: string;
  /** Defaults to "Approving {total} closures". */
  running: (total: string) => string;
  /** Defaults to "Chunk {chunk} of {chunks}". */
  chunkOf: (chunk: string, chunks: string) => string;
  progressLabel: string;
  approved: string;
  toGo: string;
  /** Read at each chunk boundary. Defaults to "Chunk {chunk} of {chunks} approved. {approved} closures.". */
  announceChunk: (chunk: string, chunks: string, approved: string) => string;
  /** Read when the run finishes. Defaults to "Approved {approved} closures.". */
  announceDone: (approved: string) => string;
  /** Defaults to "Approved {approved} closures ({first} to {last})", or without the range. */
  done: (approved: string, first?: string, last?: string) => string;
  doneDescription: string;
  again: string;
  /** Defaults to "Approval stopped at chunk {chunk} of {chunks}", naming the chunk that failed. */
  stopped: (chunk: string, chunks: string) => string;
  /** Defaults to "{approved} approved ({first} to {last}); {unchanged} unchanged.". */
  stoppedDescription: (
    approved: string,
    unchanged: string,
    first?: string,
    last?: string,
  ) => string;
  resumeNote: string;
  resume: string;
  stop: string;
}

const range = (first?: string, last?: string) =>
  first !== undefined && last !== undefined ? ` (${first} to ${last})` : '';

export const BATCH_SELECTOR_MESSAGES: BatchSelectorMessages = {
  filters: 'Filters',
  filtersLocked: 'Filters are locked while approval runs.',
  ready: (count) => `${count} closures ready`,
  readyDetail: (excluded, chunks, size) =>
    `${excluded} sampled excluded · ${chunks} chunks of ${size}`,
  approve: (count) => `Approve ${count}`,
  emptyTitle: 'Nothing left to approve for these filters',
  emptyDescription: 'New proposals appear after the daily sweep.',
  running: (total) => `Approving ${total} closures`,
  chunkOf: (chunk, chunks) => `Chunk ${chunk} of ${chunks}`,
  progressLabel: 'Chunks approved',
  approved: 'approved',
  toGo: 'to go',
  announceChunk: (chunk, chunks, approved) =>
    `Chunk ${chunk} of ${chunks} approved. ${approved} closures.`,
  announceDone: (approved) => `Approved ${approved} closures.`,
  done: (approved, first, last) => `Approved ${approved} closures${range(first, last)}`,
  doneDescription: 'Declarants notified.',
  again: 'Approve another batch',
  stopped: (chunk, chunks) => `Approval stopped at chunk ${chunk} of ${chunks}`,
  stoppedDescription: (approved, unchanged, first, last) =>
    `${approved} approved${range(first, last)}; ${unchanged} unchanged.`,
  resumeNote: 'Resume skips no numbers.',
  resume: 'Resume',
  stop: 'Stop here',
};

export type BatchSelectorProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The filter fields (cycle, type, priority band, reporting entity), disabled while it runs. */
  filters?: ReactNode;
  /** Between the filters and the batch, e.g. `StatTile`s for eligible, sampled and approved. */
  counts?: ReactNode;
  phase: BatchPhase;
  /** Items the filters select for approval. */
  eligible: number;
  /** Items the filters match but leave out, e.g. those sampled for review. */
  excluded?: number;
  /** Items approved per chunk. Defaults to 100, as the closures contract. */
  chunkSize?: number;
  /** Required while running, done or stopped. */
  progress?: BatchProgress;
  /** The first and last reference numbers the approved chunks allocated. */
  firstReference?: string | null;
  lastReference?: string | null;
  /** Why the run stopped, e.g. "The numbering service did not respond.". */
  stoppedReason?: ReactNode;
  onApprove?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  /** After a finished run: approve another batch. */
  onReset?: () => void;
  messages?: Partial<BatchSelectorMessages>;
};

/**
 * A bulk approval by filters, as the bulk closure page: the filter fields, optional counts, and
 * the batch. Ready: "{n} closures ready", what is excluded and how many chunks, and an Approve
 * button (open a confirmation from `onApprove`). Running: the filters lock, a progress bar of
 * chunks and the approved and remaining counts. Done: the count and reference range on green.
 * Stopped: an alert naming the failed chunk, what stayed approved and unchanged, with Resume and
 * Stop here. A polite live region reads progress only when a chunk completes, and once at the
 * end, so a long run does not flood a screen reader.
 */
export function BatchSelector({
  filters,
  counts,
  phase,
  eligible,
  excluded,
  chunkSize = 100,
  progress,
  firstReference,
  lastReference,
  stoppedReason,
  onApprove,
  onResume,
  onStop,
  onReset,
  messages,
  className,
  ...props
}: BatchSelectorProps) {
  const copy = { ...BATCH_SELECTOR_MESSAGES, ...messages };
  const n = formatNumber;
  const run = progress ?? {
    chunk: 0,
    chunks: Math.ceil(eligible / chunkSize),
    approved: 0,
    total: eligible,
  };
  const first = firstReference ?? undefined;
  const last = lastReference ?? undefined;

  // The live text is keyed by chunk, so a count that moves within a chunk is not read out.
  const announcementKey =
    phase === 'running' && run.chunk > 0
      ? `chunk:${String(run.chunk)}`
      : phase === 'done'
        ? 'done'
        : '';
  const announcementFor = (key: string) =>
    key === 'done'
      ? copy.announceDone(n(run.approved))
      : key === ''
        ? ''
        : copy.announceChunk(n(run.chunk), n(run.chunks), n(run.approved));
  const [announcement, setAnnouncement] = useState(() => ({
    key: announcementKey,
    text: announcementFor(announcementKey),
  }));
  if (announcement.key !== announcementKey) {
    setAnnouncement({ key: announcementKey, text: announcementFor(announcementKey) });
  }

  const bar = (tone: 'default' | 'success' | 'destructive') => (
    <ProgressBar
      label={copy.progressLabel}
      value={run.chunk}
      max={Math.max(run.chunks, 1)}
      valueText={copy.chunkOf(n(run.chunk), n(run.chunks))}
      showValue={false}
      announce={false}
      tone={tone}
    />
  );

  let batch: ReactNode;
  if (phase === 'running') {
    batch = (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Spinner />
          <b className="font-semibold">{copy.running(n(run.total))}</b>
          <span className="ml-auto text-[13px] text-muted-foreground">
            {copy.chunkOf(n(run.chunk), n(run.chunks))}
          </span>
        </div>
        {bar('default')}
        <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13.5px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground tabular-nums">{n(run.approved)}</b>{' '}
            {copy.approved}
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">
              {n(Math.max(0, run.total - run.approved))}
            </b>{' '}
            {copy.toGo}
          </span>
        </div>
      </div>
    );
  } else if (phase === 'done') {
    batch = (
      <div className="relative grid gap-0.5 rounded-lg bg-success-subtle px-4 py-3.5 pl-[46px] text-sm text-success-subtle-foreground">
        <Icon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2.2}
          className="absolute top-4 left-4 size-[18px]"
        />
        <div className="font-semibold">{copy.done(n(run.approved), first, last)}</div>
        <div>{copy.doneDescription}</div>
        {onReset === undefined ? null : (
          <div className="mt-2.5">
            <Button variant="secondary" size="sm" onClick={onReset}>
              {copy.again}
            </Button>
          </div>
        )}
      </div>
    );
  } else if (phase === 'stopped') {
    batch = (
      <div className="grid gap-4">
        {bar('destructive')}
        <div
          role="alert"
          className="relative grid gap-0.5 rounded-lg bg-destructive-subtle px-4 py-3.5 pl-[46px] text-sm text-destructive-subtle-foreground"
        >
          <Icon icon={Alert02Icon} className="absolute top-4 left-4 size-[18px]" />
          <div className="font-semibold">{copy.stopped(n(run.chunk + 1), n(run.chunks))}</div>
          <div>
            {copy.stoppedDescription(
              n(run.approved),
              n(Math.max(0, run.total - run.approved)),
              first,
              last,
            )}
            {stoppedReason === undefined ? null : <> {stoppedReason}</>} {copy.resumeNote}
          </div>
          {onResume === undefined && onStop === undefined ? null : (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {onResume === undefined ? null : (
                <Button size="sm" onClick={onResume}>
                  <Icon icon={RefreshIcon} />
                  {copy.resume}
                </Button>
              )}
              {onStop === undefined ? null : (
                <Button variant="ghost" size="sm" onClick={onStop}>
                  {copy.stop}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  } else if (eligible <= 0) {
    batch = (
      <div className="relative grid gap-0.5 rounded-lg bg-success-subtle px-4 py-3.5 pl-[46px] text-sm text-success-subtle-foreground">
        <Icon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2.2}
          className="absolute top-4 left-4 size-[18px]"
        />
        <div className="font-semibold">{copy.emptyTitle}</div>
        <div>{copy.emptyDescription}</div>
      </div>
    );
  } else {
    batch = (
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="text-base font-semibold">{copy.ready(n(eligible))}</div>
          <div className="text-[13px] text-muted-foreground">
            {copy.readyDetail(n(excluded ?? 0), n(Math.ceil(eligible / chunkSize)), n(chunkSize))}
          </div>
        </div>
        {onApprove === undefined ? null : (
          <Button onClick={onApprove} className="max-sm:w-full">
            <Icon icon={Tick02Icon} strokeWidth={2.2} />
            {copy.approve(n(eligible))}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-4', className)} {...props}>
      {filters === undefined ? null : (
        <fieldset disabled={phase === 'running'} className="@container min-w-0">
          <legend className="sr-only">{copy.filters}</legend>
          <div className="grid grid-cols-1 gap-3 @min-[700px]:grid-cols-2 @min-[1100px]:grid-cols-4">
            {filters}
          </div>
          {phase === 'running' ? (
            <p className="mt-3 text-[13px] text-muted-foreground">{copy.filtersLocked}</p>
          ) : null}
        </fieldset>
      )}
      {counts}
      {batch}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement.text}
      </div>
    </div>
  );
}
