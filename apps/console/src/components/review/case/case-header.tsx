import {
  Alert,
  AlertDescription,
  AssigneeChip,
  Badge,
  cn,
  focusRing,
  Icon,
  PriorityBadge,
  ReferenceChip,
  Tooltip,
} from '@adili/ui';
import {
  Clock01Icon,
  InformationCircleIcon,
  SquareLock02Icon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { CASE_COPY } from '../../../review-case/messages';
import { CASE_STATUSES, windowLine } from '../../../review-case/view';
import type { CaseData } from '../../../server/review-case.server';
import { TONE_BADGE } from './tones';

/**
 * The case view's header (spec 07a FE-3): the reference, status, priority and late filing; the
 * declarant with file number, type and cycle, reporting entity, receipt, version and the
 * clarification window; then a bar with who holds the case, the reviewers of record and the
 * actions (`actions`: assignment now, a registry re-check and the determination later), and the
 * notes that say what the viewer may do.
 */
export function CaseHeader({
  detail,
  employer,
  subject,
  now,
  actions,
  notes,
}: {
  detail: CaseData;
  /** The reporting entity, from the declaration when it could be read. */
  employer: string | null;
  subject: string;
  now: number;
  actions: ReactNode;
  /** Callouts under the bar, e.g. read-only or the separation of duties. */
  notes: ReactNode;
}) {
  const item = detail.case;
  const status = CASE_STATUSES[item.status];
  const window = windowLine(item.windowEndsAt, now);
  const latest = detail.versions.at(-1);
  const history = detail.reviewerHistory.map((each) => each.name);
  return (
    <header className="mb-[18px] grid gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <ReferenceChip reference={item.reference} size="sm" />
        <Badge variant={TONE_BADGE[status.tone]}>{status.label}</Badge>
        <PriorityBadge priority={item.band} />
        {item.late ? <Badge variant="warning">{CASE_COPY.lateFiling}</Badge> : null}
      </div>
      <div>
        <h1 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] min-[700px]:text-2xl">
          {item.declarantName}
        </h1>
        <p className="mt-1 flex flex-wrap gap-x-[18px] gap-y-1 text-sm text-muted-foreground">
          <span>{CASE_COPY.fileNumber(item.personnelFileNumber)}</span>
          <span>{CASE_COPY.typeCycle(CASE_COPY.type[item.type], item.cycleYear)}</span>
          {employer ? <span>{employer}</span> : null}
          <span>{CASE_COPY.received(item.receivedAt)}</span>
          {item.currentVersion > 1 && latest ? (
            <span className="inline-flex items-center gap-[5px]">
              {CASE_COPY.version(item.currentVersion, detail.versions.length)}
              <Tooltip content={CASE_COPY.versionNote(latest.submittedAt, item.currentVersion - 1)}>
                <button
                  type="button"
                  aria-label={CASE_COPY.aboutVersion}
                  className={cn(focusRing, 'inline-flex rounded-full text-muted-foreground')}
                >
                  <Icon icon={InformationCircleIcon} className="size-[15px]" />
                </button>
              </Tooltip>
            </span>
          ) : null}
          <span
            className={cn(
              'inline-flex items-center gap-[5px]',
              window.closing && 'font-medium text-warning-subtle-foreground',
            )}
          >
            <Icon icon={window.open ? Clock01Icon : SquareLock02Icon} className="size-3.5" />
            {window.text}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] bg-card py-2.5 pr-3 pl-3.5 shadow-card">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-muted-foreground">{CASE_COPY.assignedTo}</span>
          <AssigneeChip
            name={item.assignee?.name ?? null}
            current={item.assignee?.subject === subject}
          />
          {history.length > 0 ? (
            <Tooltip content={CASE_COPY.reviewersOfRecordTip(history.join(', '))}>
              <span
                tabIndex={0}
                className={cn(
                  focusRing,
                  'inline-flex items-center gap-1.5 rounded-sm text-[12.5px] text-muted-foreground',
                )}
              >
                <Icon icon={UserMultiple02Icon} className="size-3.5" />
                {CASE_COPY.reviewersOfRecord(history.length)}
              </span>
            </Tooltip>
          ) : null}
        </div>
        {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {notes}
    </header>
  );
}

/** A note under the header: read-only for others, or the separation of duties for a supervisor. */
export function HeaderNote({
  tone,
  children,
}: {
  tone: 'neutral' | 'warning';
  children: ReactNode;
}) {
  return (
    <Alert variant={tone} role="note">
      <Icon icon={tone === 'warning' ? UserMultiple02Icon : InformationCircleIcon} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
