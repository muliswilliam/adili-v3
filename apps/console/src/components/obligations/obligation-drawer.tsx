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
  formatDate,
  formatDateTime,
  formatLongDate,
  Icon,
  ObligationStatusBadge,
  obligationTypeLabel,
  reminderChannelsLabel,
  reminderOffsetLabel,
  ReminderOutcomeText,
  Skeleton,
  Tooltip,
  useObligationDetail,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useEffectEvent } from 'react';

import type {
  DeclarationsResult,
  ObligationDetail,
  ObligationListItem,
  DeclarantRef,
} from '../../server/declarations/client';
import { DetailItem, DetailList } from '../page';
import { OnboardedBadge } from './obligation-badges';
import { messages as m } from './messages';

const unavailable: DeclarationsResult<ObligationDetail> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

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
  const { detail } = useObligationDetail(obligation?.id ?? null, load, unavailable);
  const signIn = useEffectEvent(onUnauthenticated);
  const ended = detail?.ok === false && detail.error.kind === 'unauthenticated';
  useEffect(() => {
    if (ended) signIn();
  }, [ended]);
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
  // Also while the session has ended and sign-in takes over.
  if (detail === null || (!detail.ok && detail.error.kind === 'unauthenticated')) {
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
      <table className="w-full min-w-150 border-collapse text-[13.5px]">
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
                <ReminderOutcomeText outcome={reminder.outcome} channels={reminder.channels} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
