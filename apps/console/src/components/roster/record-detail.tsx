import {
  Alert,
  AlertTitle,
  AlertDescription,
  Card,
  DescriptionItem,
  DescriptionList,
  Icon,
  Skeleton,
} from '@adili/ui';
import {
  Clock01Icon,
  Flag02Icon,
  InformationCircleIcon,
  Logout03Icon,
  UserSquareIcon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { RosterRecord } from '../../server/directory/client';
import { formatPhone } from '../commissions/phone';
import { formatDate, formatDateTime } from '../format';
import { Page, PageHead, SectionCard } from '../page';
import { messages as m } from './messages';
import { isIdentityLocked, LockedChip } from './record-onboarding';
import { isFlagged, recordImport } from './record-imports';
import { ImportOutcomeBadge, NotInLatestImportBadge, RecordStateBadge } from './roster-badges';

/**
 * One roster record in full (spec 02 FE-6): every field with the national ID unmasked, its
 * status and the imports that touched it. Fields are not edited here: imports are the source of
 * truth. The reporting officer's `actions` (confirm exit, mark as still employed) sit by the title.
 */
export function RecordDetail({
  record,
  banner,
  actions,
  readOnly,
}: {
  record: RosterRecord;
  /** Above the heading, e.g. the audit notice for platform admins. */
  banner?: ReactNode;
  /** Next to the title, e.g. the reporting officer's exit actions. */
  actions?: ReactNode;
  readOnly: boolean;
}) {
  const flagged = isFlagged(record);
  return (
    <Page>
      {banner}
      <PageHead title={record.fullName} actions={actions}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13.5px] text-muted-foreground">
            {record.personnelFileNumber}
          </span>
          <RecordStateBadge state={record.state} />
          {flagged ? <NotInLatestImportBadge /> : null}
        </div>
      </PageHead>
      {flagged || record.state === 'exited' ? (
        <div className="mb-5 grid gap-3">
          {flagged ? (
            <Alert variant="warning" role="status">
              <Icon icon={Flag02Icon} />
              <AlertTitle>
                {record.flaggedAt
                  ? m.flaggedCalloutOn(formatDate(record.flaggedAt))
                  : m.flaggedCallout}
              </AlertTitle>
              {readOnly ? <AlertDescription>{m.flaggedCalloutReadOnly}</AlertDescription> : null}
            </Alert>
          ) : null}
          {record.state === 'exited' && record.exitDate ? (
            <Alert variant="info" role="status">
              <Icon icon={Logout03Icon} />
              <AlertTitle>{m.exitedCallout(formatDate(record.exitDate))}</AlertTitle>
            </Alert>
          ) : null}
        </div>
      ) : null}
      <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-5">
          <DetailsCard record={record} />
          <ImportHistory record={record} />
        </div>
        <div className="min-w-0 min-[1100px]:sticky min-[1100px]:top-[76px]">
          <StatusCard record={record} />
        </div>
      </div>
    </Page>
  );
}

function NotProvided() {
  return <span className="font-normal text-muted-foreground">{m.notProvided}</span>;
}

/** One field of the details grid (the kit's `.kv`): a small label over the value. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium break-words">{children}</dd>
    </div>
  );
}

function DetailsCard({ record }: { record: RosterRecord }) {
  const locked = isIdentityLocked(record) ? <LockedChip /> : null;
  return (
    <Card role="region" aria-label={m.details} className="gap-0 p-0 sm:p-0">
      <dl className="grid gap-x-6 gap-y-3.5 p-5 min-[600px]:grid-cols-2">
        <Field label={m.personnelFileNumber}>
          <span className="font-mono text-sm">{record.personnelFileNumber}</span>
        </Field>
        <Field label={m.fullName}>
          {record.fullName}
          {locked}
        </Field>
        <Field label={m.nationalId}>
          <span className="font-mono text-sm">{record.nationalId}</span>
          {locked}
        </Field>
        <Field label={m.designation}>{record.designation ?? <NotProvided />}</Field>
        <Field label={m.jobGroup}>{record.jobGroup ?? <NotProvided />}</Field>
        <Field label={m.reportingEntity}>{record.reportingEntity?.name ?? <NotProvided />}</Field>
        <Field label={m.appointmentDate}>
          {record.appointmentDate ? formatDate(record.appointmentDate) : <NotProvided />}
        </Field>
        <Field label={m.email}>
          {record.email ? <span className="break-all">{record.email}</span> : <NotProvided />}
        </Field>
        <Field label={m.phone}>
          {record.phone ? (
            <span className="font-mono text-sm">{formatPhone(record.phone)}</span>
          ) : (
            <NotProvided />
          )}
        </Field>
      </dl>
      <p className="flex items-start gap-2 border-t px-5 py-3.5 text-[13px] text-muted-foreground">
        <Icon icon={InformationCircleIcon} className="mt-0.5 size-3.5 shrink-0" />
        <span>{m.detailsNote}</span>
      </p>
    </Card>
  );
}

function SeenIn({ record, importId }: { record: RosterRecord; importId: string | null }) {
  const entry = recordImport(record, importId);
  if (!entry) return <span className="font-normal text-muted-foreground">{m.noValue}</span>;
  return <time dateTime={entry.startedAt}>{formatDate(entry.startedAt)}</time>;
}

function StatusCard({ record }: { record: RosterRecord }) {
  return (
    <SectionCard id="record-status" icon={UserSquareIcon} title={m.status}>
      <DescriptionList className="px-5 py-4">
        <DescriptionItem term={m.state}>
          <RecordStateBadge state={record.state} />
        </DescriptionItem>
        <DescriptionItem term={m.absentFromLatest}>
          {isFlagged(record) ? <NotInLatestImportBadge /> : m.no}
        </DescriptionItem>
        <DescriptionItem term={m.exitDate}>
          {record.exitDate ? (
            <time dateTime={record.exitDate}>{formatDate(record.exitDate)}</time>
          ) : (
            <span className="font-normal text-muted-foreground">{m.noValue}</span>
          )}
        </DescriptionItem>
        <DescriptionItem term={m.source}>
          {record.source === 'api' ? m.sourceApi : m.sourceFile}
        </DescriptionItem>
        <DescriptionItem term={m.firstSeen}>
          <SeenIn record={record} importId={record.firstSeenImportId} />
        </DescriptionItem>
        <DescriptionItem term={m.lastSeen}>
          <SeenIn record={record} importId={record.lastSeenImportId} />
        </DescriptionItem>
        <DescriptionItem term={m.lastUpdated}>
          <time dateTime={record.updatedAt}>{formatDateTime(record.updatedAt)}</time>
        </DescriptionItem>
      </DescriptionList>
    </SectionCard>
  );
}

/** The imports that touched the record, newest first (the kit's `.timeline`). */
function ImportHistory({ record }: { record: RosterRecord }) {
  return (
    <SectionCard id="record-imports" icon={Clock01Icon} title={m.importHistory}>
      {record.imports.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{m.importHistoryEmpty}</p>
      ) : (
        <ol className="grid px-5 pt-4 pb-1">
          {record.imports.map((entry) => (
            <li
              key={entry.importId}
              className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 pb-4 before:absolute before:top-[26px] before:bottom-0 before:left-[13px] before:w-[1.5px] before:bg-border last:before:hidden"
            >
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-full bg-muted text-secondary-foreground [&_svg]:size-3.5"
              >
                <Icon icon={Clock01Icon} />
              </span>
              <div className="min-w-0 pt-1">
                <p className="flex flex-wrap items-center gap-2 text-sm leading-[1.35] font-medium">
                  {m.importOn(formatDate(entry.startedAt))}
                  <ImportOutcomeBadge outcome={entry.outcome} />
                </p>
                <p className="mt-px text-[12.5px] text-muted-foreground">
                  <time dateTime={entry.startedAt}>{formatDateTime(entry.startedAt)}</time>
                  {entry.outcome === 'rejected' ? ` · ${m.outcomeRejectedHint}` : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/** Placeholder while the record loads. */
export function RecordDetailSkeleton() {
  return (
    <Page aria-busy="true" aria-label={m.record}>
      <div className="mb-[22px]">
        <Skeleton className="h-6 w-[280px] max-w-[80%]" />
        <Skeleton className="mt-3 w-[200px]" />
      </div>
      <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="grid gap-4 min-[600px]:grid-cols-2">
          {Array.from({ length: 8 }, (_, line) => (
            <div key={line} className="grid gap-1.5">
              <Skeleton className="w-[40%]" />
              <Skeleton className="w-[70%]" />
            </div>
          ))}
        </Card>
        <Card className="gap-3.5">
          {Array.from({ length: 6 }, (_, line) => (
            <Skeleton key={line} />
          ))}
        </Card>
      </div>
    </Page>
  );
}
