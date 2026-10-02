import {
  Alert,
  AlertDescription,
  AssigneeChip,
  Badge,
  Button,
  cn,
  formatDate,
  Icon,
  PriorityBadge,
  ReferenceChip,
  Tooltip,
} from '@adili/ui';
import {
  Alert02Icon,
  ArrowTurnBackwardIcon,
  Clock01Icon,
  InformationCircleIcon,
  SquareLock02Icon,
  UserCheck01Icon,
  UserMultipleIcon,
  UserSwitchIcon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { CaseActions } from '../../../review-case/case';
import { versionLine, windowLine } from '../../../review-case/case';
import { CASE_STATUSES, DECLARATION_TYPES } from '../../../review-case/labels';
import type { CaseViewDetail } from '../../../server/review-case.server';
import type { Assignee } from '../../../server/review/types';
import { TONES } from '../status-badge';
import { InfoTip } from './info-tip';
import { messages as t } from './messages';

export function CaseStatusBadge({ status }: { status: CaseViewDetail['case']['status'] }) {
  const { label, tone } = CASE_STATUSES[status];
  return <Badge variant={TONES[tone].badge}>{label}</Badge>;
}

/**
 * The case header (spec 07a FE-3, S8): reference, status, priority (an indicator, never a
 * finding) and late filing; the declarant with file number, type and cycle, when it was
 * received, the version, and the window to request clarification; then who holds the case, its
 * reviewers of record, and the assignment actions the viewer may take.
 */
export function CaseHeader({
  detail,
  reportingEntity,
  viewer,
  actions,
  supervisor,
  now,
  onAction,
  extraActions = [],
}: {
  detail: CaseViewDetail;
  /** The reporting entity, from the declaration when it could be read. */
  reportingEntity: string | null;
  viewer: Assignee;
  actions: CaseActions;
  supervisor: boolean;
  now: number;
  onAction: (action: 'claim' | 'release' | 'reassign' | 'unassign') => void;
  /** Case actions of later slices, after the assignment ones (spec 07b's registry Re-check). */
  extraActions?: ReactNode[];
}) {
  const item = detail.case;
  const window = windowLine(item.windowEndsAt, now);
  const version = versionLine(detail);
  const history = detail.reviewerHistory;
  const supervisorOfRecord =
    supervisor && history.some((reviewer) => reviewer.subject === viewer.subject);

  const buttons: ReactNode[] = [];
  if (actions.claim) {
    buttons.push(
      <Button
        key="claim"
        size="sm"
        onClick={() => {
          onAction('claim');
        }}
      >
        <Icon icon={UserCheck01Icon} />
        {t.actions.claim}
      </Button>,
    );
  }
  if (actions.release) {
    buttons.push(
      <Button
        key="release"
        size="sm"
        variant="secondary"
        onClick={() => {
          onAction('release');
        }}
      >
        <Icon icon={ArrowTurnBackwardIcon} />
        {t.actions.release}
      </Button>,
    );
  }
  if (actions.reassign) {
    buttons.push(
      <Button
        key="reassign"
        size="sm"
        variant="secondary"
        onClick={() => {
          onAction('reassign');
        }}
      >
        <Icon icon={UserSwitchIcon} />
        {actions.reassign === 'reassign' ? t.actions.reassign : t.actions.assign}
      </Button>,
    );
  }
  if (actions.unassign) {
    buttons.push(
      <Button
        key="unassign"
        size="sm"
        variant="ghost"
        onClick={() => {
          onAction('unassign');
        }}
      >
        {t.actions.unassign}
      </Button>,
    );
  }

  buttons.push(...extraActions);

  return (
    <header className="mb-[18px] grid gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <ReferenceChip reference={item.reference} size="sm" />
        <CaseStatusBadge status={item.status} />
        <PriorityBadge band={item.band} />
        {item.late ? <Badge variant="warning">{t.lateFiling}</Badge> : null}
      </div>
      <div>
        <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em]">
          {item.declarantName}
        </h1>
        <p className="mt-1 flex flex-wrap gap-x-[18px] gap-y-1 text-sm text-muted-foreground">
          <span>{t.fileNumber(item.personnelFileNumber)}</span>
          <span>{t.typeAndCycle(DECLARATION_TYPES[item.type], item.cycleYear)}</span>
          {reportingEntity ? <span>{reportingEntity}</span> : null}
          <span>{t.received(formatDate(item.receivedAt))}</span>
          {item.currentVersion > 1 || detail.versions.length > 1 ? (
            <span className="inline-flex items-center gap-[5px]">
              {version.text}
              {version.amendedAt ? (
                <InfoTip
                  label={t.aboutVersion}
                  content={t.amended(formatDate(version.amendedAt), item.currentVersion - 1)}
                />
              ) : null}
            </span>
          ) : null}
          <span
            className={cn(
              'inline-flex items-center gap-[5px]',
              window.soon && 'font-medium text-warning',
            )}
          >
            <Icon icon={window.open ? Clock01Icon : SquareLock02Icon} className="size-3.5" />
            {window.text}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 rounded-item bg-card py-2.5 pr-3 pl-3.5 shadow-card">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-muted-foreground">{t.assignedTo}</span>
          <AssigneeChip assignee={item.assignee} viewerSubject={viewer.subject} />
          {history.length > 0 ? (
            <Tooltip
              content={t.reviewersOfRecordTip(history.map((reviewer) => reviewer.name).join(', '))}
            >
              <span
                tabIndex={0}
                className="inline-flex cursor-help items-center gap-1.5 rounded-sm text-[12.5px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Icon icon={UserMultipleIcon} className="size-3.5" />
                {t.reviewersOfRecord(history.length)}
              </span>
            </Tooltip>
          ) : null}
        </div>
        {buttons.length > 0 ? <div className="ml-auto flex flex-wrap gap-2">{buttons}</div> : null}
      </div>
      {supervisorOfRecord ? (
        <Alert variant="warning" role="note">
          <Icon icon={Alert02Icon} />
          <AlertDescription>{t.supervisorOfRecord}</AlertDescription>
        </Alert>
      ) : null}
      {actions.heldBy ? (
        <Alert variant="neutral" role="note">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription>{t.readOnly(actions.heldBy.name)}</AlertDescription>
        </Alert>
      ) : null}
    </header>
  );
}
