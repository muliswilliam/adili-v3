import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useState } from 'react';

import { cn } from '../lib/cn';
import { formatDate } from '../lib/format-date';
import { formatNumber } from '../lib/format-number';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';
import { Icon } from './icon';
import { ProgressBar } from './progress-bar';
import { Spinner } from './spinner';

/**
 * Where a bulk approval stands. `pending`: nothing is proposed yet, as the sweep proposes only
 * after the cycle's clarification window closes. `ready`: the filters' eligible items wait for
 * approval. `running`: chunks are being approved. `done`: every chunk is approved. `stopped`: a
 * chunk failed; the chunks before it stay approved and the rest are unchanged.
 */
export type BatchPhase = 'pending' | 'ready' | 'running' | 'done' | 'stopped';

export const BATCH_PHASES: readonly BatchPhase[] = [
  'pending',
  'ready',
  'running',
  'done',
  'stopped',
];

/** A run's progress: `chunk` chunks of `chunks` approved, `approved` items of `total`. */
export interface BatchProgress {
  chunk: number;
  chunks: number;
  approved: number;
  total: number;
}

/** The first and last reference numbers a run's approved chunks allocated. */
export interface BatchReferences {
  first: string;
  last: string;
}

/** Counts reach the messages already formatted with thousands separators ("1,240"). */
export interface BatchSelectorMessages {
  /** The filter group's name for screen readers. Defaults to "Filters". */
  filters: string;
  filtersLocked: string;
  pendingTitle: string;
  /** Defaults to "They appear after the clarification window closes on {date}.". */
  pendingDescription: (date?: string) => string;
  /** Defaults to "{count} closures ready". */
  ready: (count: string) => string;
  /** Defaults to "{excluded} sampled excluded". */
  excluded: (excluded: string) => string;
  /** Defaults to "{chunks} chunks of {size}". */
  chunks: (chunks: string, size: string) => string;
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
  done: (approved: string, references?: BatchReferences) => string;
  doneDescription: string;
  /** Defaults to "{skipped} closures of cases you once held are left for another supervisor.". */
  skipped: (skipped: string) => string;
  again: string;
  /** Defaults to "Approval stopped at chunk {chunk} of {chunks}", naming the chunk that failed. */
  stopped: (chunk: string, chunks: string) => string;
  /** Defaults to "{approved} approved ({first} to {last}); {unchanged} unchanged.". */
  stoppedDescription: (approved: string, unchanged: string, references?: BatchReferences) => string;
  resumeNote: string;
  resume: string;
  stop: string;
}

const range = (references?: BatchReferences) =>
  references === undefined ? '' : ` (${references.first} to ${references.last})`;

export const BATCH_SELECTOR_MESSAGES: BatchSelectorMessages = {
  filters: 'Filters',
  filtersLocked: 'Filters are locked while approval runs.',
  pendingTitle: 'No proposals yet for these filters',
  pendingDescription: (date) =>
    date === undefined
      ? 'They appear after the clarification window closes.'
      : `They appear after the clarification window closes on ${date}.`,
  ready: (count) => `${count} closures ready`,
  excluded: (excluded) => `${excluded} sampled excluded`,
  chunks: (chunks, size) => `${chunks} chunks of ${size}`,
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
  done: (approved, references) => `Approved ${approved} closures${range(references)}`,
  doneDescription: 'Declarants notified.',
  skipped: (skipped) =>
    `${skipped} closures of cases you once held are left for another supervisor.`,
  again: 'Approve another batch',
  stopped: (chunk, chunks) => `Approval stopped at chunk ${chunk} of ${chunks}`,
  stoppedDescription: (approved, unchanged, references) =>
    `${approved} approved${range(references)}; ${unchanged} unchanged.`,
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
  /** While pending: when the clarification window closes (the contract's `windowClosedAt`). */
  windowClosesAt?: string | null;
  /** Required while running, done or stopped. */
  progress?: BatchProgress;
  /** The reference range the approved chunks allocated. */
  references?: BatchReferences | null;
  /** When done: closures left for another supervisor (the contract's `skipped`). */
  skipped?: number;
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
 * the batch. Pending: no proposals until the clarification window closes. Ready: "{n} closures
 * ready", what is excluded and how many chunks, and an Approve button (open a confirmation from
 * `onApprove`). Running: the filters lock, a progress bar of chunks and the approved and
 * remaining counts. Done: the count and reference range on green. Stopped: an alert naming the
 * failed chunk, what stayed approved and unchanged, with Resume and Stop here. A polite live
 * region reads progress only when a chunk completes, and once at the end, so a long run does
 * not flood a screen reader.
 */
export function BatchSelector({
  filters,
  counts,
  phase,
  eligible,
  excluded,
  chunkSize = 100,
  windowClosesAt,
  progress,
  references,
  skipped = 0,
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
  const readyChunks = Math.ceil(eligible / chunkSize);
  const run = progress ?? { chunk: 0, chunks: readyChunks, approved: 0, total: eligible };
  const remaining = formatNumber(Math.max(0, run.total - run.approved));
  const range = references ?? undefined;

  // The live text is keyed by chunk, so a count that moves within a chunk is not read out. A
  // stopped run keeps its chunk's key, so resuming does not read the same chunk again.
  const announcementKey =
    (phase === 'running' || phase === 'stopped') && run.chunk > 0
      ? `chunk:${String(run.chunk)}`
      : phase === 'done'
        ? 'done'
        : '';
  const [announcement, setAnnouncement] = useState({ key: '', text: '' });
  if (announcement.key !== announcementKey) {
    setAnnouncement({
      key: announcementKey,
      text:
        announcementKey === 'done'
          ? copy.announceDone(formatNumber(run.approved))
          : announcementKey === ''
            ? ''
            : copy.announceChunk(
                formatNumber(run.chunk),
                formatNumber(run.chunks),
                formatNumber(run.approved),
              ),
    });
  }

  const bar = (tone: 'default' | 'destructive') => (
    <ProgressBar
      label={copy.progressLabel}
      value={run.chunk}
      max={Math.max(run.chunks, 1)}
      valueText={copy.chunkOf(formatNumber(run.chunk), formatNumber(run.chunks))}
      showValue={false}
      announce={false}
      tone={tone}
    />
  );

  let batch: ReactNode;
  if (phase === 'pending') {
    batch = (
      <Alert role={undefined} variant="neutral">
        <Icon icon={Clock01Icon} />
        <AlertTitle>{copy.pendingTitle}</AlertTitle>
        <AlertDescription>
          {copy.pendingDescription(
            windowClosesAt === undefined || windowClosesAt === null
              ? undefined
              : formatDate(windowClosesAt),
          )}
        </AlertDescription>
      </Alert>
    );
  } else if (phase === 'running') {
    batch = (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Spinner />
          <b className="font-semibold">{copy.running(formatNumber(run.total))}</b>
          <span className="ml-auto text-[13px] text-muted-foreground">
            {copy.chunkOf(formatNumber(run.chunk), formatNumber(run.chunks))}
          </span>
        </div>
        {bar('default')}
        <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13.5px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground tabular-nums">
              {formatNumber(run.approved)}
            </b>{' '}
            {copy.approved}
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">{remaining}</b> {copy.toGo}
          </span>
        </div>
      </div>
    );
  } else if (phase === 'done') {
    batch = (
      <Alert role={undefined} variant="success">
        <Icon icon={CheckmarkCircle02Icon} strokeWidth={2.2} />
        <AlertTitle>{copy.done(formatNumber(run.approved), range)}</AlertTitle>
        <AlertDescription>
          {copy.doneDescription}
          {skipped > 0 ? <> {copy.skipped(formatNumber(skipped))}</> : null}
        </AlertDescription>
        {onReset === undefined ? null : (
          <div className="mt-2.5">
            <Button variant="secondary" size="sm" onClick={onReset}>
              {copy.again}
            </Button>
          </div>
        )}
      </Alert>
    );
  } else if (phase === 'stopped') {
    batch = (
      <div className="grid gap-4">
        {bar('destructive')}
        <Alert variant="destructive">
          <Icon icon={Alert02Icon} />
          <AlertTitle>
            {copy.stopped(formatNumber(run.chunk + 1), formatNumber(run.chunks))}
          </AlertTitle>
          <AlertDescription>
            {copy.stoppedDescription(formatNumber(run.approved), remaining, range)}
            {stoppedReason === undefined ? null : <> {stoppedReason}</>} {copy.resumeNote}
          </AlertDescription>
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
        </Alert>
      </div>
    );
  } else if (eligible <= 0) {
    batch = (
      <Alert role={undefined} variant="success">
        <Icon icon={CheckmarkCircle02Icon} strokeWidth={2.2} />
        <AlertTitle>{copy.emptyTitle}</AlertTitle>
        <AlertDescription>{copy.emptyDescription}</AlertDescription>
      </Alert>
    );
  } else {
    const chunksText = copy.chunks(formatNumber(readyChunks), formatNumber(chunkSize));
    batch = (
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="text-base font-semibold">{copy.ready(formatNumber(eligible))}</div>
          <div className="text-[13px] text-muted-foreground">
            {excluded === undefined
              ? chunksText
              : `${copy.excluded(formatNumber(excluded))} · ${chunksText}`}
          </div>
        </div>
        {onApprove === undefined ? null : (
          <Button onClick={onApprove} className="max-sm:w-full">
            <Icon icon={Tick02Icon} strokeWidth={2.2} />
            {copy.approve(formatNumber(eligible))}
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
