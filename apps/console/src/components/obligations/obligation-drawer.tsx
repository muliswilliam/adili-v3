import {
  Alert,
  AlertTitle,
  Button,
  DateText,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  formatLongDate,
  Icon,
  obligationTypeLabel,
  reminderChannelsLabel,
  reminderOffsetLabel,
  reminderOutcomeLabel,
  Skeleton,
  Tooltip,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Cancel01Icon,
  MinusSignIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react';

import type {
  DeclarationsResult,
  ObligationDetail,
  ObligationListItem,
  DeclarantRef,
  Reminder,
} from '../../server/declarations/client';
import { formatDate, formatDateTime } from '../format';
import { DetailItem, DetailList } from '../page';
import { ObligationStatusBadge, OnboardedBadge } from './obligation-badges';
import { messages as m } from './messages';

const unavailable = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

export interface ObligationDrawerProps {
  /** The row that was opened; null when the drawer is closed. */
  obligation: ObligationListItem | null;
  onClose: () => void;
  /** Reads the obligation with its reminder history; a server function in the app. */
  load: (id: string) => Promise<DeclarationsResult<ObligationDetail>>;
  onUnauthenticated: () => void;
  /** The declarant's roster record, for those who may open it. */
  recordLink?: (declarant: DeclarantRef) => ReactNode;
}

/**
 * One obligation in full (spec 04 FE-3): the row's fields at once, then the reminder history
 * once read, and the way to the declarant's roster record.
 */
export function ObligationDrawer({
  obligation,
  onClose,
  load,
  onUnauthenticated,
  recordLink,
}: ObligationDrawerProps) {
  const detail = useObligationDetail(obligation?.id ?? null, load, onUnauthenticated);
  return (
    <Drawer
      open={obligation !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {obligation ? (
        <DrawerContent size="wide">
          <DrawerHeader>
            <DrawerTitle>{obligation.declarant.fullName}</DrawerTitle>
            <DrawerDescription>
              {obligationTypeLabel(obligation.type, obligation.statementDate)}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <Fields obligation={obligation} />
            <Reminders obligation={obligation} detail={detail} />
          </DrawerBody>
          <DrawerFooter>
            {recordLink ? recordLink(obligation.declarant) : null}
            <DrawerClose asChild>
              <Button variant="ghost">{m.close}</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

/** Reads the obligation `id` when it changes; null while reading (or with no id). */
function useObligationDetail(
  id: string | null,
  load: ObligationDrawerProps['load'],
  onUnauthenticated: () => void,
): DeclarationsResult<ObligationDetail> | null {
  const [found, setFound] = useState<{
    id: string;
    result: DeclarationsResult<ObligationDetail>;
  } | null>(null);
  const read = useEffectEvent((at: string) => load(at));
  const unauthenticated = useEffectEvent(() => {
    onUnauthenticated();
  });
  useEffect(() => {
    if (id === null) return;
    let stopped = false;
    void read(id)
      .catch(() => unavailable)
      .then((result) => {
        if (stopped) return;
        if (!result.ok && result.error.kind === 'unauthenticated') {
          unauthenticated();
          return;
        }
        setFound({ id, result });
      });
    return () => {
      stopped = true;
    };
  }, [id]);
  return found?.id === id ? found.result : null;
}

function Fields({ obligation }: { obligation: ObligationListItem }) {
  const { declarant, commission } = obligation;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <ObligationStatusBadge status={obligation.status} />
        {obligation.status === 'upcoming' ? (
          <DateText date={obligation.statementDate} kind="opens" />
        ) : (
          <DateText date={obligation.dueDate} />
        )}
      </div>
      <DetailList className="px-0 py-0">
        <DetailItem term={m.fileNumber}>
          <span className="font-mono text-[13.5px]">{declarant.personnelFileNumber}</span>
        </DetailItem>
        <DetailItem term={m.columnOnboarded}>
          <span className="flex flex-wrap items-center gap-2">
            <OnboardedBadge onboarded={declarant.onboarded} />
            {declarant.ofr ? (
              <span className="font-mono text-[13px] text-muted-foreground">{declarant.ofr}</span>
            ) : null}
          </span>
        </DetailItem>
        <DetailItem term={m.type}>
          {obligationTypeLabel(obligation.type, obligation.statementDate)}
        </DetailItem>
        <DetailItem term={m.commission}>
          {commission.name}{' '}
          <span className="font-mono text-xs font-medium tracking-[0.04em] text-muted-foreground">
            {commission.issuerCode}
          </span>
        </DetailItem>
        <DetailItem term={m.cycle}>
          <span className="font-mono text-[13px]">{obligation.cycleKey}</span>
        </DetailItem>
        <DetailItem
          term={
            <Tooltip content={m.statementDateHint}>
              <span
                tabIndex={0}
                className="cursor-help rounded-sm border-b border-dashed border-input outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {m.statementDate}
              </span>
            </Tooltip>
          }
        >
          {formatLongDate(obligation.statementDate)}
        </DetailItem>
        <DetailItem term={m.dueDate}>{formatLongDate(obligation.dueDate)}</DetailItem>
      </DetailList>
    </>
  );
}

function Reminders({
  obligation,
  detail,
}: {
  obligation: ObligationListItem;
  detail: DeclarationsResult<ObligationDetail> | null;
}) {
  const schedule = [
    m.reminderSchedule(obligation.commission.name, obligation.policyVersion),
    obligation.declarant.onboarded ? null : m.reminderScheduleNotOnboarded,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section aria-labelledby="obligation-reminders" className="grid gap-1.5">
      <h3 id="obligation-reminders" className="text-[13px] font-semibold text-muted-foreground">
        {m.reminders}
      </h3>
      <p className="text-[13px] text-muted-foreground">{schedule}</p>
      <ReminderHistory detail={detail} />
    </section>
  );
}

function ReminderHistory({ detail }: { detail: DeclarationsResult<ObligationDetail> | null }) {
  if (detail === null) {
    return (
      <div aria-busy="true" aria-label={m.reminderHistory} className="grid gap-2.5 py-2">
        <Skeleton className="w-full" />
        <Skeleton className="w-5/6" />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (!detail.ok) {
    const notFound = detail.error.kind === 'problem' && detail.error.problem.status === 404;
    return (
      <Alert variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertTitle>{notFound ? m.detailNotFound : m.detailErrorTitle}</AlertTitle>
      </Alert>
    );
  }
  const { reminders } = detail.data;
  if (reminders.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{m.noReminders}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-[13.5px]">
        <caption className="sr-only">{m.reminderHistory}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {[
              m.reminderOffset,
              m.reminderScheduled,
              m.reminderSent,
              m.reminderChannels,
              m.reminderOutcome,
            ].map((column) => (
              <th key={column} scope="col" className="py-2 pr-4 font-medium whitespace-nowrap">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reminders.map((reminder) => (
            <tr
              key={`${reminder.offsetDays}-${reminder.scheduledAt}`}
              className="border-b last:border-b-0"
            >
              <th scope="row" className="py-2.5 pr-4 text-left font-normal whitespace-nowrap">
                {reminderOffsetLabel(reminder.offsetDays)}
              </th>
              <td className="py-2.5 pr-4 whitespace-nowrap">{formatDate(reminder.scheduledAt)}</td>
              <td className="py-2.5 pr-4 whitespace-nowrap">
                {reminder.sentAt ? (
                  <span title={formatDateTime(reminder.sentAt)}>{formatDate(reminder.sentAt)}</span>
                ) : (
                  m.noValue
                )}
              </td>
              <td className="py-2.5 pr-4 whitespace-nowrap">
                {reminderChannelsLabel(reminder.channels)}
              </td>
              <td className="py-2.5 align-top">
                <Outcome reminder={reminder} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OUTCOME_STYLES = {
  sent: { icon: Tick02Icon, className: 'text-success' },
  failed: { icon: Cancel01Icon, className: 'text-destructive' },
  skipped: { icon: MinusSignIcon, className: 'text-muted-foreground' },
} as const;

function Outcome({ reminder }: { reminder: Reminder }) {
  const style =
    reminder.outcome === 'sent'
      ? OUTCOME_STYLES.sent
      : reminder.outcome === 'failed'
        ? OUTCOME_STYLES.failed
        : OUTCOME_STYLES.skipped;
  return (
    <span className={`inline-flex items-start gap-1.5 font-medium ${style.className}`}>
      <Icon icon={style.icon} strokeWidth={2.2} className="mt-0.5 size-3.5 shrink-0" />
      <span>{reminderOutcomeLabel(reminder.outcome, reminder.channels)}</span>
    </span>
  );
}
