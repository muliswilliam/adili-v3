import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  formatDate,
  formatDateTime,
  Icon,
  IconTile,
  LateBadge,
  ReferenceChip,
  Spinner,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Download04Icon,
  Globe02Icon,
  InformationCircleIcon,
  PlugSocketIcon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useState } from 'react';

import type { FormMResult } from '../../server/form-m.server';
import type { DocumentLink } from '../../server/form-m-sign-off.server';
import { usePollWhile } from '../use-poll-while';
import { PartHeading } from './form-m-document';
import type { CompiledReport } from './form-m-workspace';
import { messages as m } from './sign-off-messages';

/** How often, and how many times, the page reloads while the PDF and receipt are issued. */
const ISSUE_POLL_MS = 2000;
const ISSUE_POLLS = 30;

export interface SubmittedHeaderProps {
  report: CompiledReport;
  /** A short-lived link to the Form M PDF or the receipt. */
  documentLink: (documentId: string) => Promise<FormMResult<DocumentLink>>;
  /** Starts the browser's download from the link (`downloadFrom`). */
  download: (url: string) => void;
  /** The session ended: sign in again. */
  onSignedOut: () => void;
}

/**
 * A submitted report's header (spec 09 FE-2 "submitted"): submitted to EACC, by whom and when,
 * the `RPT` reference to copy, on time or late, hosted or filed through the API, and the Form M
 * PDF and the acknowledgement receipt to download, "Preparing…" until documents has issued them
 * (the page reloads meanwhile). Then "Report as submitted" over the document as filed.
 */
export function SubmittedHeader({
  report,
  documentLink,
  download,
  onSignedOut,
}: SubmittedHeaderProps) {
  const { formMDocumentId, receiptDocumentId } = report;
  const issued = formMDocumentId !== null && receiptDocumentId !== null;
  const poll = usePollWhile(!issued, ISSUE_POLL_MS, ISSUE_POLLS);
  const [fetching, setFetching] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const federated = report.source === 'federated';
  const late = report.late === true;
  const when = report.submittedAt ? formatDateTime(report.submittedAt) : '';

  const fetchAndDownload = async (documentId: string) => {
    setFetching(documentId);
    setFailed(false);
    const link = await documentLink(documentId).catch(
      () => ({ ok: false, error: { kind: 'unavailable', detail: null } }) as const,
    );
    setFetching(null);
    if (link.ok) download(link.data.downloadUrl);
    else if (link.error.kind === 'unauthenticated') onSignedOut();
    else setFailed(true);
  };

  const downloadButton = (documentId: string, label: string, primary: boolean) => (
    <Button
      type="button"
      variant={primary ? 'default' : 'secondary'}
      disabled={fetching !== null}
      aria-busy={fetching === documentId || undefined}
      onClick={() => void fetchAndDownload(documentId)}
    >
      {fetching === documentId ? <Spinner className="size-4" /> : <Icon icon={Download04Icon} />}
      {label}
    </Button>
  );

  return (
    <>
      <Card className="gap-0 p-0 sm:p-0">
        <div className="flex flex-wrap items-start gap-4 px-[22px] pt-[22px] pb-4">
          <IconTile size="lg" tone={late ? 'warning' : 'success'} className="size-11">
            <Icon icon={federated ? PlugSocketIcon : Tick02Icon} strokeWidth={2.2} />
          </IconTile>
          <div className="min-w-[240px] flex-1">
            <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{m.submittedTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {federated
                ? m.byOwnSystem(when)
                : report.confirmedBy
                  ? m.confirmedBy(report.confirmedBy.name, when)
                  : m.submittedAt(when)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {report.reference ? <ReferenceChip reference={report.reference} size="sm" /> : null}
              {late ? (
                <LateBadge label={m.lateBadge(formatDate(report.dueDate))} />
              ) : (
                <Badge variant="success">
                  <Icon icon={Tick02Icon} strokeWidth={2.4} />
                  {m.onTime}
                </Badge>
              )}
              <Badge>
                <Icon icon={federated ? PlugSocketIcon : Globe02Icon} />
                {federated ? m.federated : m.hosted}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-[22px] pb-4 @max-[699px]:[&>*]:flex-1">
          {issued ? (
            <>
              {downloadButton(formMDocumentId, m.downloadFormM, true)}
              {downloadButton(receiptDocumentId, m.downloadReceipt, false)}
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled>
                <Spinner className="size-4" />
                {m.preparingFormM}
              </Button>
              <Button type="button" variant="secondary" disabled>
                <Spinner className="size-4" />
                {m.preparingReceipt}
              </Button>
              {poll.exhausted ? (
                <Button type="button" variant="ghost" onClick={poll.restart}>
                  <Icon icon={RefreshIcon} />
                  {m.checkAgain}
                </Button>
              ) : null}
            </>
          )}
        </div>
        <div className="grid gap-2.5 px-[22px] pb-5">
          {failed ? (
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>{m.downloadFailed}</AlertDescription>
            </Alert>
          ) : null}
          {!issued && poll.exhausted ? (
            <p role="status" className="text-[13px] text-muted-foreground">
              {m.preparingSlow}
            </p>
          ) : null}
          <Alert role={undefined}>
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{m.noCorrections}</AlertDescription>
          </Alert>
        </div>
      </Card>
      <PartHeading>{m.reportAsSubmitted}</PartHeading>
    </>
  );
}
