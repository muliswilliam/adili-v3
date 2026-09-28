import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  formatDate,
  formatDateTime,
  Icon,
  obligationCycleLabel,
  obligationTypeLabel,
  reminderChannelsLabel,
  reminderOffsetLabel,
  reminderOutcomeLabel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import {
  AlertCircleIcon,
  MinusSignIcon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useState } from 'react';

import type { Obligation, Reminder } from '../../server/declarations/types';
import type { ObligationDetailResult } from '../../server/obligations.server';
import { messages as m } from './obligation-messages';
import {
  type LoadObligationDetail,
  ObligationStatus,
  StartDeclarationButton,
  StatementDateTerm,
} from './obligation-parts';

type Detail = { status: 'loading' } | ObligationDetailResult;

/** The obligation's detail, loaded for `id` and asked again each time `attempt` goes up. */
function useObligationDetail(id: string, attempt: number, loadDetail: LoadObligationDetail) {
  const key = `${id}:${String(attempt)}`;
  const [loaded, setLoaded] = useState<{ key: string; result: ObligationDetailResult } | null>(
    null,
  );

  useEffect(() => {
    let current = true;
    const settle = (result: ObligationDetailResult) => {
      if (current) setLoaded({ key, result });
    };
    loadDetail(id).then(settle, () => {
      settle({ status: 'unavailable' });
    });
    return () => {
      current = false;
    };
  }, [id, key, loadDetail]);

  return loaded?.key === key ? loaded.result : ({ status: 'loading' } satisfies Detail);
}

/**
 * An obligation's detail: every field of the card, the Commission and its issuer code, the
 * cycle, the statement date's meaning spelled out, and the reminder history, which is loaded
 * when the drawer opens (`GET /v1/obligations/{id}`).
 */
export function ObligationDrawer({
  obligation,
  open,
  onOpenChange,
  loadDetail,
  now,
}: {
  obligation: Obligation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadDetail: LoadObligationDetail;
  now?: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const { id } = obligation;
  const detail: Detail = useObligationDetail(id, attempt, loadDetail);

  const { commission } = obligation;
  const title = obligationTypeLabel(obligation.type, obligation.statementDate);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="wide">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>
            {commission.name} ·{' '}
            <span className="font-mono text-[13px]">{commission.issuerCode}</span>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <div className="flex flex-wrap items-center gap-2">
            <ObligationStatus obligation={obligation} now={now} />
          </div>
          {obligation.status === 'overdue' ? (
            <Alert variant="warning">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>
                <strong className="font-semibold">{m.overdueLead}</strong> {m.overdueText}
              </AlertDescription>
            </Alert>
          ) : null}
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact term={m.cycle}>
              {obligationCycleLabel(obligation.type, obligation.statementDate)}
            </Fact>
            <Fact term={<StatementDateTerm />}>
              {formatDate(obligation.statementDate)}
              <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
                {m.statementDateTip}
              </span>
            </Fact>
            <Fact term={m.dueDate}>{formatDate(obligation.dueDate)}</Fact>
          </dl>
          <section aria-labelledby={`${id}-reminders`} className="grid gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id={`${id}-reminders`} className="text-[14.5px] font-semibold">
                {m.reminders}
              </h3>
              <p className="text-[13px] text-muted-foreground">
                {m.reminderSchedule(commission.name)}
              </p>
            </div>
            <ReminderHistory
              detail={detail}
              onRetry={() => {
                setAttempt((count) => count + 1);
              }}
            />
          </section>
        </DrawerBody>
        <DrawerFooter className="flex-wrap items-center">
          <p className="mr-auto text-[13px] text-muted-foreground max-sm:w-full">
            {m.filingOpensSoon}
          </p>
          <DrawerClose asChild>
            <Button variant="secondary" className="max-sm:flex-1">
              {m.close}
            </Button>
          </DrawerClose>
          <StartDeclarationButton className="max-sm:flex-1" />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function Fact({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="text-[15px] font-medium">{children}</dd>
    </div>
  );
}

function ReminderHistory({ detail, onRetry }: { detail: Detail; onRetry: () => void }) {
  if (detail.status === 'loading') {
    return (
      <div aria-busy="true" aria-label={m.reminderHistory} className="grid gap-3 py-2">
        <Skeleton className="w-full" />
        <Skeleton className="w-4/5" />
        <Skeleton className="w-3/5" />
      </div>
    );
  }
  if (detail.status === 'unavailable') {
    return (
      <Alert variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertTitle>{m.historyErrorTitle}</AlertTitle>
        <AlertDescription className="grid justify-items-start gap-2.5">
          <p>{m.errorDetail}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <Icon icon={RefreshIcon} />
            {m.tryAgain}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (detail.status === 'not-found') {
    return (
      <Alert variant="warning">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>{m.historyNotFound}</AlertDescription>
      </Alert>
    );
  }
  const { reminders } = detail.obligation;
  if (reminders.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.noReminders}</p>;
  }
  return <ReminderTable reminders={reminders} />;
}

// On phones each reminder becomes a short list of labelled facts with the outcome underneath.
const phoneCell =
  'max-sm:p-0 max-sm:first:pl-0 max-sm:last:pr-0 max-sm:before:mr-1 max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]';

function ReminderTable({ reminders }: { reminders: Reminder[] }) {
  return (
    <Table caption={m.reminderHistory} className="text-[13.5px]">
      <TableHeader className="max-sm:sr-only">
        <TableRow>
          <TableHead className="bg-transparent pl-0 first:pl-0">{m.whenColumn}</TableHead>
          <TableHead className="bg-transparent">{m.scheduledColumn}</TableHead>
          <TableHead className="bg-transparent">{m.sentColumn}</TableHead>
          <TableHead className="bg-transparent">{m.channelsColumn}</TableHead>
          <TableHead className="bg-transparent pr-0 last:pr-0">{m.outcomeColumn}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reminders.map((reminder) => (
          <TableRow
            key={`${String(reminder.offsetDays)}-${reminder.scheduledAt}`}
            className="max-sm:grid max-sm:gap-y-0.5 max-sm:py-2.5"
          >
            <TableCell className="py-2.5 pl-0 align-top font-medium first:pl-0 max-sm:p-0">
              {reminderOffsetLabel(reminder.offsetDays)}
            </TableCell>
            <TableCell
              data-label={`${m.scheduledColumn}:`}
              className={cn('py-2.5 align-top whitespace-nowrap', phoneCell)}
            >
              {formatDateTime(reminder.scheduledAt)}
            </TableCell>
            <TableCell
              data-label={`${m.sentColumn}:`}
              className={cn('py-2.5 align-top whitespace-nowrap', phoneCell)}
            >
              {reminder.sentAt ? formatDateTime(reminder.sentAt) : m.notSent}
            </TableCell>
            <TableCell
              data-label={`${m.channelsColumn}:`}
              className={cn('py-2.5 align-top whitespace-nowrap', phoneCell)}
            >
              {reminderChannelsLabel(reminder.channels)}
            </TableCell>
            <TableCell className="py-2.5 pr-0 align-top last:pr-0 max-sm:mt-1 max-sm:p-0">
              <Outcome reminder={reminder} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Outcome({ reminder }: { reminder: Reminder }) {
  const icon =
    reminder.outcome === 'sent'
      ? { icon: Tick02Icon, className: 'text-success' }
      : reminder.outcome === 'failed'
        ? { icon: AlertCircleIcon, className: 'text-destructive' }
        : { icon: MinusSignIcon, className: 'text-muted-foreground' };
  return (
    <span className="inline-flex items-start gap-1.5">
      <Icon icon={icon.icon} className={cn('mt-0.5 size-3.5 shrink-0', icon.className)} />
      {reminderOutcomeLabel(reminder.outcome, reminder.channels)}
    </span>
  );
}
