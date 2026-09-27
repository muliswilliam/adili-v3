import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  CheckboxItem,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  Cancel01Icon,
  Clock01Icon,
  InformationCircleIcon,
  MinusSignIcon,
  PlayIcon,
  RefreshIcon,
  Tick02Icon,
  Upload04Icon,
} from '@hugeicons/core-free-icons';
import { Fragment, type ReactNode } from 'react';

import type { RosterImportPreview } from '../../server/directory/client';
import { type CheckFailure, type MappingRow, mappingRows, type StartFailure } from './column-check';
import { FileBox } from './file-box';
import { messages as m } from './messages';
import type { CleanUpload } from './upload';
import { WizardCard, WizardFoot, WizardSection, WizardTitle } from './wizard-card';
import { ColumnName } from './wizard-template-step';
import { Busy, PassedScan } from './wizard-upload-step';

/** What the column check has to show. */
export type ColumnCheckView =
  | { phase: 'loading' }
  /** `detail`: the directory's reason, for a file it cannot read. */
  | { phase: 'failed'; failure: CheckFailure; detail?: string }
  /** `defaulted`: the "complete roster" box was ticked because the roster is empty. */
  | { phase: 'ready'; preview: RosterImportPreview; defaulted: boolean };

export interface WizardCheckStepProps {
  upload: CleanUpload;
  check: ColumnCheckView;
  declaredComplete: boolean;
  onDeclaredCompleteChange: (complete: boolean) => void;
  starting: boolean;
  startFailure: StartFailure | null;
  onStart: () => void;
  /** Asks for the columns again after a failed check. */
  onRetryCheck: () => void;
  /** Opens the import that is already running. */
  onViewRunning: () => void;
  /** Back to the upload step, for another file. */
  onBack: () => void;
}

/**
 * Step 3: how the file's columns line up with the template, the rows detected, the "complete
 * roster" choice, then "Start import". A missing required column blocks the start.
 */
export function WizardCheckStep(props: WizardCheckStepProps) {
  const { upload, check, onBack } = props;
  const rows = check.phase === 'ready' ? check.preview.estimatedRows : null;
  return (
    <WizardCard>
      <WizardSection className="grid gap-4">
        <WizardTitle>{m.checkTitle}</WizardTitle>
        <FileBox
          name={upload.fileName}
          size={upload.size}
          detail={
            rows !== null ? (
              <>
                <b className="font-semibold text-foreground">{m.rowsDetected(rows)}</b> {m.detected}
              </>
            ) : undefined
          }
        >
          {check.phase === 'loading' ? <Busy>{m.checking}</Busy> : <PassedScan />}
        </FileBox>
      </WizardSection>
      {check.phase === 'loading' ? (
        <MappingSkeleton />
      ) : check.phase === 'failed' ? (
        <WizardSection className="border-t">
          <CheckFailed
            failure={check.failure}
            detail={check.detail}
            onRetry={props.onRetryCheck}
            onBack={onBack}
          />
        </WizardSection>
      ) : (
        <Ready {...props} preview={check.preview} defaulted={check.defaulted} />
      )}
      {check.phase === 'ready' ? null : (
        <WizardFoot>
          <BackButton onBack={onBack} />
        </WizardFoot>
      )}
    </WizardCard>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="secondary" onClick={onBack}>
      <Icon icon={ArrowLeft01Icon} />
      {m.back}
    </Button>
  );
}

function Ready({
  preview,
  defaulted,
  declaredComplete,
  onDeclaredCompleteChange,
  starting,
  startFailure,
  onStart,
  onViewRunning,
  onBack,
}: WizardCheckStepProps & { preview: RosterImportPreview; defaulted: boolean }) {
  const rows = mappingRows(preview);
  const missing = preview.missingRequired;
  const blocked = missing.length > 0;
  const start = (
    <Button onClick={onStart} disabled={blocked || starting}>
      <Icon icon={PlayIcon} className="size-[15px]" />
      {starting ? m.starting : m.startImport}
    </Button>
  );
  return (
    <>
      <div className="border-t">
        <div className="hidden min-[700px]:block">
          <MappingTable rows={rows} />
        </div>
        <div className="min-[700px]:hidden">
          <MappingList rows={rows} />
        </div>
      </div>
      <WizardSection className="grid gap-4 border-t">
        {blocked ? (
          <MissingAlert columns={missing} onUploadAgain={onBack} />
        ) : preview.mapping.ignored.length > 0 ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Icon icon={InformationCircleIcon} className="size-3.5 shrink-0" />
            {m.ignoredTip}
          </p>
        ) : null}
        <div className="rounded-xl bg-muted p-3.5">
          <CheckboxItem
            label={<b className="font-semibold">{m.completeLabel}</b>}
            hint={m.completeHint}
            checked={declaredComplete}
            disabled={blocked || starting}
            onChange={(event) => {
              onDeclaredCompleteChange(event.currentTarget.checked);
            }}
          />
          {defaulted && !blocked ? (
            <p className="mt-2 pl-[30px] text-[13px] text-muted-foreground">
              {m.completeDefaulted}
            </p>
          ) : null}
        </div>
        {startFailure ? (
          <StartFailed failure={startFailure} onViewRunning={onViewRunning} onBack={onBack} />
        ) : null}
      </WizardSection>
      <WizardFoot>
        <BackButton onBack={onBack} />
        <span className="ml-auto">
          {blocked ? (
            <Tooltip content={m.addMissingFirst}>
              {/* A disabled button takes no focus or hover; the wrapper explains it. */}
              <span tabIndex={0} className="inline-flex rounded-lg">
                {start}
              </span>
            </Tooltip>
          ) : (
            start
          )}
        </span>
      </WizardFoot>
    </>
  );
}

function StatusBadge({ row }: { row: MappingRow }) {
  switch (row.status) {
    case 'missing':
      return (
        <Badge variant="destructive">
          <Icon icon={Cancel01Icon} strokeWidth={2.4} />
          {m.missing}
        </Badge>
      );
    case 'matched':
      return (
        <Badge variant="success">
          <Icon icon={Tick02Icon} strokeWidth={2.4} />
          {m.matched}
        </Badge>
      );
    case 'not-in-file':
      return <Badge>{m.notInFile}</Badge>;
    case 'ignored':
      return (
        <Badge>
          <Icon icon={MinusSignIcon} strokeWidth={2.4} />
          {m.ignored}
        </Badge>
      );
  }
}

/** The file's column, or why there is none. */
function SourceText({ row }: { row: MappingRow }) {
  switch (row.status) {
    case 'missing':
      return <span className="text-muted-foreground">{m.notFound}</span>;
    case 'not-in-file':
      return <span className="text-muted-foreground">{m.notInFile}</span>;
    case 'matched':
    case 'ignored':
      return <span className="break-words">{row.source}</span>;
  }
}

/** The template column, or "Not imported" for an ignored one. */
function FieldText({ row }: { row: MappingRow }) {
  switch (row.status) {
    case 'ignored':
      return <span className="text-muted-foreground">{m.notImported}</span>;
    case 'matched':
      return <ColumnName>{row.field}</ColumnName>;
    case 'missing':
    case 'not-in-file':
      return (
        <>
          <ColumnName>{row.field}</ColumnName>{' '}
          <span className="text-[13px] text-muted-foreground">
            {row.status === 'missing' ? m.requiredHint : m.optionalHint}
          </span>
        </>
      );
  }
}

const rowKey = (row: MappingRow) =>
  row.status === 'ignored' ? `ignored:${row.source}` : `${row.status}:${row.field}`;

function MappingTable({ rows }: { rows: MappingRow[] }) {
  return (
    <Table caption={m.mappingCaption}>
      <TableHeader>
        <TableRow>
          <TableHead>{m.yourColumn}</TableHead>
          <TableHead>{m.rosterField}</TableHead>
          <TableHead>{m.mappingStatus}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            <TableHead scope="row" className="font-normal">
              <SourceText row={row} />
            </TableHead>
            <TableCell>
              <FieldText row={row} />
            </TableCell>
            <TableCell>
              <StatusBadge row={row} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 700px the table becomes a list of cards. */
function MappingList({ rows }: { rows: MappingRow[] }) {
  return (
    <ul aria-label={m.mappingCaption}>
      {rows.map((row) => (
        <li key={rowKey(row)} className="grid gap-1.5 border-b px-5 py-3.5 last:border-b-0">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-[14.5px]">
              <SourceText row={row} />
            </p>
            <StatusBadge row={row} />
          </div>
          <p className="text-[13.5px]">
            <FieldText row={row} />
          </p>
        </li>
      ))}
    </ul>
  );
}

function MappingSkeleton() {
  return (
    <div className="grid gap-4 border-t px-5 py-5 sm:px-6" aria-label={m.checking}>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_90px] items-center gap-6">
          <Skeleton className="h-4 w-[70%]" />
          <Skeleton className="h-4 w-[60%]" />
          <Skeleton className="h-6 w-[80px] rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** "`a`, `b` and `c`" */
function ColumnList({ columns }: { columns: string[] }) {
  return columns.map((name, index) => (
    <Fragment key={name}>
      {index > 0 ? (index === columns.length - 1 ? ` ${m.templateIntroAnd} ` : ', ') : null}
      <ColumnName>{name}</ColumnName>
    </Fragment>
  ));
}

function MissingAlert({
  columns,
  onUploadAgain,
}: {
  columns: string[];
  onUploadAgain: () => void;
}) {
  return (
    <Problem
      title={columns.length === 1 ? m.missingTitle : m.missingTitleMany}
      text={
        <>
          {m.missingBefore} <ColumnList columns={columns} /> {m.missingAfter}
        </>
      }
    >
      <UploadAgain onClick={onUploadAgain} />
    </Problem>
  );
}

function UploadAgain({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      <Icon icon={Upload04Icon} />
      {m.uploadAgain}
    </Button>
  );
}

function CheckFailed({
  failure,
  detail,
  onRetry,
  onBack,
}: {
  failure: CheckFailure;
  detail?: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  switch (failure) {
    case 'upload-gone':
      return (
        <Problem title={m.uploadGoneTitle} text={m.uploadGoneText}>
          <UploadAgain onClick={onBack} />
        </Problem>
      );
    case 'unreadable':
      return (
        <Problem title={m.unreadableTitle} text={detail ?? m.unreadableText}>
          <UploadAgain onClick={onBack} />
        </Problem>
      );
    case 'failed':
      return (
        <Problem title={m.checkFailedTitle} text={m.checkFailedText}>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <Icon icon={RefreshIcon} />
            {m.tryAgain}
          </Button>
        </Problem>
      );
  }
}

function StartFailed({
  failure,
  onViewRunning,
  onBack,
}: {
  failure: StartFailure;
  onViewRunning: () => void;
  onBack: () => void;
}) {
  switch (failure) {
    case 'running':
      return (
        <Problem title={m.runningTitle} text={m.runningText}>
          <Button variant="secondary" size="sm" onClick={onViewRunning}>
            {m.viewProgress}
          </Button>
        </Problem>
      );
    case 'limited':
      return <Problem icon={Clock01Icon} title={m.limitedTitle} text={m.limitedText} />;
    case 'upload-gone':
      return (
        <Problem title={m.uploadGoneTitle} text={m.uploadGoneText}>
          <UploadAgain onClick={onBack} />
        </Problem>
      );
    case 'failed':
      return <Problem title={m.startFailedTitle} text={m.startFailedText} />;
  }
}

function Problem({
  icon = AlertCircleIcon,
  title,
  text,
  children,
}: {
  icon?: typeof AlertCircleIcon;
  title: string;
  text: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Alert variant="destructive">
      <Icon icon={icon} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
      {children ? <div className="mt-2.5 flex flex-wrap gap-2">{children}</div> : null}
    </Alert>
  );
}
