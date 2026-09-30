import {
  Button,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  formatLongDate,
  ObligationCountdown,
  ObligationStatusBadge,
  obligationTypeLabel,
  ReminderHistory,
  StatementDateTerm,
  useObligationDetail,
} from '@adili/ui';
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
  const { detail, retry } = useObligationDetail(obligation?.id ?? null, load, unavailable);
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
            <Reminders obligation={obligation} detail={detail} onRetry={retry} />
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
        <ObligationCountdown obligation={obligation} />
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
          term={<StatementDateTerm hint={m.statementDateHint}>{m.statementDate}</StatementDateTerm>}
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
  onRetry,
}: {
  obligation: ObligationListItem;
  detail: DeclarationsResult<ObligationDetail> | null;
  onRetry: () => void;
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
      <History detail={detail} onRetry={onRetry} />
    </section>
  );
}

function History({
  detail,
  onRetry,
}: {
  detail: DeclarationsResult<ObligationDetail> | null;
  onRetry: () => void;
}) {
  // Also while the session has ended and sign-in takes over: skeleton lines.
  if (detail === null || (!detail.ok && detail.error.kind === 'unauthenticated')) {
    return <ReminderHistory reminders={null} />;
  }
  if (!detail.ok) {
    const notFound = detail.error.kind === 'problem' && detail.error.problem.status === 404;
    return (
      <ReminderHistory
        reminders={null}
        error={
          notFound
            ? { title: m.detailNotFound, tone: 'warning', retry: false }
            : { title: m.detailErrorTitle }
        }
        onRetry={onRetry}
      />
    );
  }
  return <ReminderHistory reminders={detail.data.reminders} />;
}
