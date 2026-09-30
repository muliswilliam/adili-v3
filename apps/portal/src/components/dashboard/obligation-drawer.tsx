import {
  Alert,
  AlertDescription,
  Button,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  formatDate,
  Icon,
  obligationCycleLabel,
  obligationTypeLabel,
  ReminderHistory,
  type ReminderHistoryError,
  useObligationDetail,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { DeclarationListItem, Obligation } from '../../server/declarations/types';
import type { ObligationDetailResult } from '../../server/obligations.server';
import { messages as m } from './obligation-messages';
import {
  type LoadObligationDetail,
  ObligationStatus,
  SessionEnded,
  StartDeclarationButton,
  StatementDateTerm,
} from './obligation-parts';

const unavailable: ObligationDetailResult = { status: 'unavailable' };

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
  declarations,
  now,
}: {
  obligation: Obligation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadDetail: LoadObligationDetail;
  declarations: readonly DeclarationListItem[];
  now?: number;
}) {
  const { id } = obligation;
  const { detail, retry } = useObligationDetail(id, loadDetail, unavailable);

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
              <h3 id={`${id}-reminders`} className="text-sm font-semibold">
                {m.reminders}
              </h3>
              <p className="text-[13px] text-muted-foreground">
                {m.reminderSchedule(commission.name)}
              </p>
            </div>
            <Reminders detail={detail} onRetry={retry} />
          </section>
        </DrawerBody>
        <DrawerFooter className="flex-wrap items-center">
          <p className="mr-auto text-[13px] text-muted-foreground max-sm:w-full">
            {obligation.status === 'upcoming'
              ? m.submitFrom(formatDate(obligation.statementDate))
              : null}
          </p>
          <DrawerClose asChild>
            <Button variant="secondary" className="max-sm:flex-1">
              {m.close}
            </Button>
          </DrawerClose>
          <StartDeclarationButton
            obligation={obligation}
            declarations={declarations}
            className="max-sm:flex-1"
          />
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

/** The reminder history once read; a session that ended says so instead. */
function Reminders({
  detail,
  onRetry,
}: {
  /** Null while loading. */
  detail: ObligationDetailResult | null;
  onRetry: () => void;
}) {
  if (detail?.status === 'unauthenticated') return <SessionEnded />;
  const error: ReminderHistoryError | null =
    detail?.status === 'unavailable'
      ? { title: m.historyErrorTitle, detail: m.errorDetail }
      : detail?.status === 'not-found'
        ? { title: m.historyNotFound, tone: 'warning', retry: false }
        : null;
  return (
    <ReminderHistory
      reminders={detail?.status === 'ok' ? detail.obligation.reminders : null}
      error={error}
      onRetry={onRetry}
    />
  );
}
