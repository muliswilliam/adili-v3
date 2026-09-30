import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogTrigger,
  formatDate,
  formatDateTime,
  Icon,
  Tooltip,
  useToast,
  focusRing,
} from '@adili/ui';
import {
  InformationCircleIcon,
  PencilEdit02Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import type { TenantPolicyHistory, TenantPolicyVersion } from '../../server/directory/client';
import { SectionCard } from '../page';
import { messages as m } from './messages';
import { PolicyDialogContent, type SavePolicyVersion } from './policy-dialog';
import { monthDayText, policyVersions, reminderOffsetsText } from './policy-form';

export interface PolicyCardProps {
  history: TenantPolicyHistory;
  /**
   * Creates a new version with another start date, for those who may (commission admins of the
   * tenant and platform admins); without it the card is read only.
   */
  save?: SavePolicyVersion;
  onUnauthenticated: () => void;
  className?: string;
}

/**
 * The obligations policy of a Commission (spec 04 FE-4): statutory periods, reminder offsets and
 * the obligations start date, which those who may change it do through a dialog that saves a new
 * version; then the version history, newest first.
 */
export function PolicyCard({ history, save, onUnauthenticated, className }: PolicyCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  // A fresh dialog (draft and Idempotency-Key) each time it opens: cancelling discards both.
  const [dialogSession, setDialogSession] = useState(0);
  const { current } = history;

  const saved = (version: TenantPolicyVersion) => {
    setDialogOpen(false);
    toast({ title: m.savedToast(version.version) });
    // Refetch so the card, the history and the Commission's policy version show the new one.
    void router.invalidate();
  };

  return (
    <SectionCard
      id="policy"
      icon={Settings01Icon}
      title={m.cardTitle}
      description={m.inForceSince(current.version, formatDate(current.effectiveFrom))}
      className={className}
    >
      <dl className="divide-y px-5 py-1">
        <PolicyRow term={m.statutoryPeriods}>
          <span className="block">{m.initialPeriod(current.initialDueAfterAppointmentDays)}</span>
          <span className="block">
            {m.biennialPeriod(
              monthDayText(current.biennial.statementDate),
              monthDayText(current.biennial.dueDate),
            )}
          </span>
          <span className="block">{m.finalPeriod(current.finalDueAfterExitDays)}</span>
        </PolicyRow>
        <PolicyRow term={m.reminders}>{reminderOffsetsText(current.reminderOffsetsDays)}</PolicyRow>
        <PolicyRow
          term={m.startDate}
          action={
            save ? (
              <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                  if (open) setDialogSession((session) => session + 1);
                  setDialogOpen(open);
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="secondary" size="sm">
                    <Icon icon={PencilEdit02Icon} />
                    {m.change}
                  </Button>
                </DialogTrigger>
                <PolicyDialogContent
                  key={dialogSession}
                  current={current}
                  save={save}
                  onSaved={saved}
                  onUnauthenticated={onUnauthenticated}
                />
              </Dialog>
            ) : undefined
          }
        >
          <span className="inline-flex items-center gap-1.5">
            <time dateTime={current.obligationsStartDate}>
              {formatDate(current.obligationsStartDate)}
            </time>
            <Tooltip content={m.startDateTip}>
              <button
                type="button"
                aria-label={m.startDateTipLabel}
                className={cn(
                  'inline-grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground',
                  focusRing,
                )}
              >
                <Icon icon={InformationCircleIcon} className="size-3.5" />
              </button>
            </Tooltip>
          </span>
        </PolicyRow>
      </dl>
      <VersionHistory history={history} />
    </SectionCard>
  );
}

/** The kit's `.prow`: label, value and an optional action on the right. */
function PolicyRow({
  term,
  action,
  children,
}: {
  term: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-3 text-sm min-[520px]:grid-cols-[170px_minmax(0,1fr)] min-[520px]:items-center min-[520px]:gap-4">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 items-center justify-between gap-4 leading-[1.5] font-medium">
        <div className="min-w-0">{children}</div>
        {action}
      </dd>
    </div>
  );
}

function VersionHistory({ history }: { history: TenantPolicyHistory }) {
  const versions = policyVersions(history);
  return (
    <section aria-labelledby="policy-history-title" className="px-5 pt-1 pb-4">
      <h4 id="policy-history-title" className="mb-0.5 text-[13.5px] font-semibold">
        {m.history}
      </h4>
      <ul className="divide-y">
        {versions.map((version) => {
          const inForce = version.version === history.current.version;
          return (
            <li key={version.id} className="flex items-start gap-3 py-2.5">
              <span
                className={cn(
                  'mt-px inline-grid h-6 min-w-7.5 place-items-center rounded-md px-1.5 text-[12.5px] font-semibold tabular-nums',
                  inForce ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                v{version.version}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium">
                  <span>{m.historyEffective(formatDateTime(version.effectiveFrom))}</span>
                  {inForce ? (
                    <Badge variant="success" className="h-5">
                      {m.inForce}
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {version.version === 1
                    ? m.platformDefaults
                    : m.historyStartDate(formatDate(version.obligationsStartDate))}
                  {version.createdByName ? ` · ${m.historyBy(version.createdByName)}` : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
