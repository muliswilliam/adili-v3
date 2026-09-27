import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Icon,
  ProgressBar,
  Skeleton,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  InformationCircleIcon,
  RefreshIcon,
  Upload04Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { RosterImport } from '../../server/directory/client';
import { formatNumber } from '../format';
import { FileBox } from './file-box';
import { CompletenessBadge } from './import-badges';
import { failureDetail, failureReason, importProgress } from './import-progress';
import { messages as m } from './messages';
import { WizardCard, WizardFoot, WizardSection, WizardTitle } from './wizard-card';
import { Busy } from './wizard-upload-step';

export interface WizardImportStepProps {
  /** The import as last read; null until the first answer. */
  imp: RosterImport | null;
  /** The file's size when it was uploaded in this visit; unknown after a refresh. */
  fileSize?: number;
  /** Polling keeps failing; it goes on trying. */
  reconnecting: boolean;
  onImportAnother: () => void;
}

/**
 * Step 4: the running import's progress, polled until it ends, or why it stopped. The officer
 * may leave; the import goes on and this page picks it up again from the URL.
 */
export function WizardImportStep({
  imp,
  fileSize,
  reconnecting,
  onImportAnother,
}: WizardImportStepProps) {
  if (!imp) return <ImportSkeleton />;
  const failed = imp.state === 'failed';
  const progress = importProgress(imp);
  return (
    <WizardCard>
      <WizardSection className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <WizardTitle>{failed ? m.importStoppedTitle : m.importingTitle}</WizardTitle>
          {failed ? null : <CompletenessBadge declaredComplete={imp.declaredComplete} />}
        </div>
        {imp.fileName ? <FileBox name={imp.fileName} size={fileSize} /> : null}
        {failed ? (
          <>
            <ProgressBar
              label={m.importProgress}
              value={progress.kind === 'rows' ? progress.percent : 0}
              tone="destructive"
              showValue={false}
            />
            <FailureAlert imp={imp} viewReport />
          </>
        ) : (
          <RunningProgress imp={imp} />
        )}
        {failed ? null : (
          <Alert variant="neutral" role="note">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{m.canLeave}</AlertDescription>
          </Alert>
        )}
        {reconnecting && !failed ? <Busy>{m.reconnecting}</Busy> : null}
      </WizardSection>
      <WizardFoot>
        {failed ? (
          <>
            <Button onClick={onImportAnother}>
              <Icon icon={Upload04Icon} />
              {m.importCorrected}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/roster">{m.goToRoster}</Link>
            </Button>
          </>
        ) : (
          <Button asChild variant="secondary">
            <Link to="/roster">{m.goToRoster}</Link>
          </Button>
        )}
      </WizardFoot>
    </WizardCard>
  );
}

/** A running import's progress bar: reading the file, then rows applied out of the total. */
export function RunningProgress({ imp }: { imp: RosterImport }) {
  const progress = importProgress(imp);
  return progress.kind === 'reading' ? (
    <ProgressBar label={m.importProgress} value={0} indeterminate status={m.readingFile} />
  ) : (
    <ProgressBar
      label={m.importProgress}
      value={progress.percent}
      valueText={m.rowsOf(progress.processed, progress.total)}
      status={<RowsOf processed={progress.processed} total={progress.total} />}
    />
  );
}

/** "21,400 of 48,431 rows", the numbers in bold. */
function RowsOf({ processed, total }: { processed: number; total: number }) {
  return (
    <>
      <b className="font-semibold tabular-nums">{formatNumber(processed)}</b> {m.of}{' '}
      <b className="font-semibold tabular-nums">{formatNumber(total)}</b> {m.rowsWord(total)}
    </>
  );
}

/** Why the import stopped and what became of the rows; in the wizard, a way to its report. */
export function FailureAlert({
  imp,
  viewReport = false,
}: {
  imp: RosterImport;
  viewReport?: boolean;
}) {
  const failure = imp.failure ?? { code: 'internal', detail: '' };
  const reason = failureReason(failure);
  const detail = failureDetail(failure);
  const applied = imp.processedRows > 0;
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>
        {applied ? m.stoppedAfter(imp.processedRows, reason) : m.stoppedBefore(reason)}
      </AlertTitle>
      {detail ? <AlertDescription>{detail}</AlertDescription> : null}
      <AlertDescription>{applied ? m.stoppedKept : m.stoppedNothing}</AlertDescription>
      {viewReport ? (
        <div className="mt-2.5">
          <Button asChild variant="secondary" size="sm">
            <Link to="/roster/imports/$importId" params={{ importId: imp.id }}>
              {m.viewReport}
              <Icon icon={ArrowRight01Icon} />
            </Link>
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}

function ImportSkeleton() {
  return (
    <WizardCard aria-busy="true" aria-label={m.loading}>
      <WizardSection className="grid gap-4">
        <Skeleton className="h-6 w-[140px]" />
        <Skeleton className="h-[68px] w-full rounded-xl" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-4 w-[180px]" />
      </WizardSection>
      <WizardFoot>
        <Skeleton className="h-11 w-[130px] rounded-lg" />
      </WizardFoot>
    </WizardCard>
  );
}

/** The import could not be read at all: gone (404) or the directory is unreachable. */
export function ImportUnavailable({
  notFound,
  onRetry,
  onStartNew,
}: {
  notFound: boolean;
  onRetry: () => void;
  onStartNew: () => void;
}) {
  return (
    <WizardCard>
      <WizardSection>
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertTitle>{notFound ? m.importNotFoundTitle : m.importLoadFailedTitle}</AlertTitle>
          <AlertDescription>{notFound ? m.importNotFoundText : m.errorDetail}</AlertDescription>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {notFound ? (
              <Button variant="secondary" size="sm" onClick={onStartNew}>
                <Icon icon={Upload04Icon} />
                {m.startNewImport}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <Icon icon={RefreshIcon} />
                {m.tryAgain}
              </Button>
            )}
          </div>
        </Alert>
      </WizardSection>
    </WizardCard>
  );
}
