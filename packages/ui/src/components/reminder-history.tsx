import { AlertCircleIcon, RefreshIcon } from '@hugeicons/core-free-icons';

import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/format-date';
import {
  obligationMessages as m,
  type ReminderChannel,
  reminderChannelsLabel,
  reminderOffsetLabel,
  type ReminderOutcome,
} from '../lib/obligations';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';
import { Icon } from './icon';
import { ReminderOutcomeText } from './reminder-outcome';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

/** One reminder of an obligation, as `declarations.yaml`'s `Reminder`. */
export interface ReminderHistoryEntry {
  offsetDays: number;
  scheduledAt: string;
  sentAt: string | null;
  channels: readonly ReminderChannel[];
  outcome: ReminderOutcome;
}

export interface ReminderHistoryError {
  title: string;
  detail?: string;
  /** `destructive` (default) when loading failed; `warning` when there is nothing to load. */
  tone?: 'destructive' | 'warning';
  /** Whether trying again can help (default true); needs `onRetry`. */
  retry?: boolean;
}

// On phones each reminder becomes a short list of labelled facts with the outcome underneath.
const phoneCell =
  'max-sm:p-0 max-sm:first:pl-0 max-sm:last:pr-0 max-sm:before:mr-1 max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]';

/**
 * An obligation's reminder history (spec 04: the portal's and the console's drawers): when each
 * reminder was due before the due date, when it was scheduled and sent (date and time, Kenyan
 * time), the channels and the outcome in plain words. Skeleton lines while `reminders` is null,
 * `error` (with a retry) when they could not be read.
 */
export function ReminderHistory({
  reminders,
  error,
  onRetry,
}: {
  /** Null while loading. */
  reminders: readonly ReminderHistoryEntry[] | null;
  error?: ReminderHistoryError | null;
  onRetry?: () => void;
}) {
  if (error) {
    const { title, detail, tone = 'destructive', retry = true } = error;
    return (
      <Alert variant={tone}>
        <Icon icon={AlertCircleIcon} />
        <AlertTitle>{title}</AlertTitle>
        {detail || (retry && onRetry) ? (
          <AlertDescription className="grid justify-items-start gap-2.5">
            {detail ? <p>{detail}</p> : null}
            {retry && onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <Icon icon={RefreshIcon} />
                {m.tryAgain}
              </Button>
            ) : null}
          </AlertDescription>
        ) : null}
      </Alert>
    );
  }
  if (reminders === null) {
    return (
      <div aria-busy="true" aria-label={m.reminderHistory} className="grid gap-3 py-2">
        <Skeleton className="w-full" />
        <Skeleton className="w-4/5" />
        <Skeleton className="w-3/5" />
      </div>
    );
  }
  if (reminders.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{m.noReminders}</p>;
  }
  return (
    <Table caption={m.reminderHistory} className="text-[13.5px]">
      <TableHeader className="max-sm:sr-only">
        <TableRow>
          <TableHead className="bg-transparent pl-0 first:pl-0">{m.reminderWhen}</TableHead>
          <TableHead className="bg-transparent">{m.reminderScheduled}</TableHead>
          <TableHead className="bg-transparent">{m.reminderSent}</TableHead>
          <TableHead className="bg-transparent">{m.reminderChannels}</TableHead>
          <TableHead className="bg-transparent pr-0 last:pr-0">{m.reminderOutcome}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reminders.map((reminder) => (
          <TableRow
            key={`${String(reminder.offsetDays)}-${reminder.scheduledAt}`}
            className="max-sm:grid max-sm:gap-y-0.5 max-sm:py-2.5"
          >
            <TableCell className="py-2.5 pl-0 align-top font-medium whitespace-nowrap first:pl-0 max-sm:p-0">
              {reminderOffsetLabel(reminder.offsetDays)}
            </TableCell>
            <TableCell
              data-label={`${m.reminderScheduled}:`}
              className={cn('py-2.5 align-top whitespace-nowrap', phoneCell)}
            >
              {formatDateTime(reminder.scheduledAt)}
            </TableCell>
            <TableCell
              data-label={`${m.reminderSent}:`}
              className={cn('py-2.5 align-top whitespace-nowrap', phoneCell)}
            >
              {reminder.sentAt ? formatDateTime(reminder.sentAt) : m.noValue}
            </TableCell>
            <TableCell
              data-label={`${m.reminderChannels}:`}
              className={cn('py-2.5 align-top whitespace-nowrap', phoneCell)}
            >
              {reminderChannelsLabel(reminder.channels)}
            </TableCell>
            <TableCell className="min-w-44 py-2.5 pr-0 align-top last:pr-0 max-sm:mt-1 max-sm:min-w-0 max-sm:p-0">
              <ReminderOutcomeText outcome={reminder.outcome} channels={reminder.channels} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
