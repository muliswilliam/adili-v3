import {
  Alert,
  AttachmentList,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  DeadlineChip,
  deadlineSoonDays,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatDate,
  formatDateTime,
  Icon,
  IconTile,
  Spinner,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Certificate01Icon,
  PrinterIcon,
  SentIcon,
  UserCheck01Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { getCertifiedCopyLink, markSelfAccessDelivered } from '../../../server/self-access';
import type { SelfAccessApplicationDetail } from '../../../server/self-access.server';
import { ReadOnlyBadge } from '../../commissions/badges';
import { pendingTab } from '../../download';
import { Page } from '../../page';
import { type Poll, usePollWhile } from '../../use-poll-while';
import { goToSignIn } from '../../sign-in-redirect';
import { Muted, SideCard } from '../side-cards';
import { type ApplicationState, applicationState, deadlineRuns } from './application-view';
import { StateBadge } from './applications-list';
import { messages as m } from './messages';

/**
 * How often the page looks again while the copy is prepared, after how many it says it is slow,
 * and after how many it stops (two minutes) and offers to check again.
 */
const PREPARING_POLL_MS = 2000;
const PREPARING_SLOW_AFTER = 15;
const PREPARING_POLLS = 60;

/**
 * One written self-access application (spec 10 slice #302): the application with its identity
 * check and the representative's documents on the left; on the right its certified copy, being
 * prepared, failed, or ready for the recording officer to print and mark collected or
 * dispatched.
 */
export function ApplicationDetailView({
  application,
  readOnly,
  commissionCode,
}: {
  application: SelfAccessApplicationDetail;
  readOnly: boolean;
  commissionCode: string;
}) {
  const state = applicationState(application);
  const poll = usePollWhile(state === 'preparing', PREPARING_POLL_MS, PREPARING_POLLS);

  return (
    <Page>
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StateBadge application={application} />
            <Badge>{m.selfAccess}</Badge>
            {readOnly ? <ReadOnlyBadge /> : null}
          </div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]">
            {application.declarant.fullName}
          </h1>
          <p className="mt-1 text-[14.5px] text-muted-foreground">
            {m.receivedLine(
              application.declarant.personnelFileNumber,
              formatDate(application.receivedAt),
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5 pt-1">
          {deadlineRuns(state) ? (
            <>
              <DeadlineChip
                due={application.deadlineAt}
                soonDays={deadlineSoonDays.certifiedCopy}
                label={m.issueBy}
                late={application.late}
              />
              <span className="text-[13.5px] text-muted-foreground">
                {m.issueByOn(formatDate(application.deadlineAt))}
              </span>
            </>
          ) : application.certifiedCopy.issuedAt ? (
            <DeadlineChip
              due={application.deadlineAt}
              soonDays={deadlineSoonDays.certifiedCopy}
              label={m.issueBy}
              met={m.issuedOn(formatDate(application.certifiedCopy.issuedAt))}
            />
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-4 min-[1080px]:grid-cols-[minmax(0,1fr)_380px]">
        <ApplicationCard application={application} commissionCode={commissionCode} />
        <aside className="order-first grid min-w-0 gap-4 min-[1080px]:order-none">
          <CopyCard application={application} state={state} readOnly={readOnly} poll={poll} />
        </aside>
      </div>
    </Page>
  );
}

function Part({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t px-5 py-4 first:border-t-0">
      {label ? (
        <h3 className="text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {label}
        </h3>
      ) : null}
      {children}
    </div>
  );
}

function Fact({ term, children, sub }: { term: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium break-words">{children}</dd>
      {sub ? <dd className="text-[13px] text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

function ApplicationCard({
  application,
  commissionCode,
}: {
  application: SelfAccessApplicationDetail;
  commissionCode: string;
}) {
  const { representative } = application;
  return (
    <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="application-title">
      <CardHeader className="border-b px-5 py-4">
        <CardTitle id="application-title">{m.applicationTitle}</CardTitle>
      </CardHeader>
      <Part>
        <dl className="grid gap-4 min-[640px]:grid-cols-3">
          <Fact
            term={m.appliedBy}
            sub={representative ? m.representativeLine(representative.idNumber) : undefined}
          >
            {representative ? representative.name : m.whoDeclarant}
          </Fact>
          <Fact
            term={m.version}
            sub={<span className="font-mono">{application.declarationReference}</span>}
          >
            {m.versionValue(application.version)}
          </Fact>
          <Fact term={m.delivery}>
            {application.deliveryMethod === 'collection'
              ? m.deliveryCollection(commissionCode)
              : m.deliveryDispatch}
          </Fact>
        </dl>
      </Part>
      <Part label={m.identityCheck}>
        <p className="text-sm text-secondary-foreground">{application.identityNote}</p>
        <p className="text-[13px] text-muted-foreground">
          {m.recordedLine(application.recordedBy, formatDateTime(application.receivedAt))}
        </p>
      </Part>
      {representative ? (
        <Part label={m.representativeDocuments}>
          <AttachmentList
            label={m.representativeDocuments}
            attachments={[representative.authority, representative.identification].map(
              (upload) => ({
                id: upload.uploadId,
                name: upload.fileName,
                status: 'linked',
                detail: m.scannedClean,
              }),
            )}
          />
        </Part>
      ) : null}
      <Part>
        <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <Icon icon={ViewIcon} className="mt-px size-4 shrink-0" />
          {m.declarantSees}
        </p>
      </Part>
    </Card>
  );
}

function CopyRow({ application }: { application: SelfAccessApplicationDetail }) {
  const { certifiedCopy } = application;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 shadow-card">
      <IconTile className="size-9">
        <Icon icon={Certificate01Icon} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{m.copyName(application.version)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Badge variant="warning" className="h-[18px] px-1.5 text-[11px]">
            {m.restricted}
          </Badge>
          <span className="font-mono">
            {certifiedCopy.reference ?? application.declarationReference}
          </span>
        </div>
      </div>
    </div>
  );
}

function CopyFacts({ application }: { application: SelfAccessApplicationDetail }) {
  const { certifiedCopy } = application;
  return (
    <dl className="grid gap-3 text-sm">
      {certifiedCopy.issuedAt ? (
        <Fact term={m.issuedAt}>{formatDateTime(certifiedCopy.issuedAt)}</Fact>
      ) : null}
      {certifiedCopy.verificationId ? (
        <Fact term={m.verification}>
          <span className="font-mono text-[13px]">{certifiedCopy.verificationId}</span>
        </Fact>
      ) : null}
      {application.deliveredAt ? (
        <Fact term={application.deliveryMethod === 'collection' ? m.collected : m.dispatched}>
          {formatDateTime(application.deliveredAt)}
        </Fact>
      ) : null}
    </dl>
  );
}

function CopyCard({
  application,
  state,
  readOnly,
  poll,
}: {
  application: SelfAccessApplicationDetail;
  state: ApplicationState;
  readOnly: boolean;
  poll: Poll;
}) {
  if (state === 'preparing') {
    return (
      <SideCard id="copy" title={m.copyTitle}>
        <p role="status" className="flex items-center gap-2.5 text-sm">
          <Spinner className="size-4" />
          {m.preparing}
        </p>
        {poll.exhausted ? (
          <div className="grid justify-items-start gap-2">
            <p className="text-[13px] text-muted-foreground">{m.preparingStopped}</p>
            <Button variant="secondary" size="sm" onClick={poll.restart}>
              {m.checkAgain}
            </Button>
          </div>
        ) : poll.polls >= PREPARING_SLOW_AFTER ? (
          <p className="text-[13px] text-muted-foreground">{m.preparingSlow}</p>
        ) : null}
      </SideCard>
    );
  }
  if (state === 'failed') {
    return (
      <SideCard id="copy" title={m.copyTitle}>
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>{m.failedText}</AlertDescription>
        </Alert>
        {readOnly ? null : <p className="text-[13px] text-muted-foreground">{m.failedHint}</p>}
      </SideCard>
    );
  }
  return (
    <SideCard id="copy" title={m.copyTitle}>
      <CopyRow application={application} />
      <CopyFacts application={application} />
      <DownloadAction application={application} readOnly={readOnly} />
      {state === 'ready' ? (
        readOnly ? (
          <Muted>{m.supervisorWaits}</Muted>
        ) : (
          <MarkDelivered application={application} />
        )
      ) : null}
    </SideCard>
  );
}

/**
 * "Download to print": documents hands the officer who recorded the application, named on the
 * copy, a short-lived link (audited as their download). It opens in a new tab for printing.
 */
function DownloadAction({
  application,
  readOnly,
}: {
  application: SelfAccessApplicationDetail;
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { documentId } = application.certifiedCopy;
  // The supervisor hands nothing over: nothing to download or explain.
  if (!documentId || (readOnly && !application.recordedByCaller)) return null;
  if (!application.recordedByCaller) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {m.downloadNotYours(application.recordedBy)}
      </p>
    );
  }
  const download = async () => {
    setBusy(true);
    setError(null);
    // Opened in the click, so the browser does not block it as a pop-up; filled in once known.
    const tab = pendingTab();
    const result = await getCertifiedCopyLink({ data: { documentId } }).catch(
      (): Awaited<ReturnType<typeof getCertifiedCopyLink>> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }),
    );
    setBusy(false);
    if (result.ok) {
      tab.show(result.data.downloadUrl);
      return;
    }
    tab.close();
    if (result.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    setError(
      result.error.kind === 'problem' && result.error.problem.status === 404
        ? m.downloadNotYours(application.recordedBy)
        : m.downloadFailed,
    );
  };
  return (
    <div className="grid gap-2">
      <Button
        variant="secondary"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void download()}
      >
        {busy ? <Spinner className="size-4" /> : <Icon icon={PrinterIcon} />}
        {busy ? m.downloading : m.downloadCopy}
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MarkDelivered({ application }: { application: SelfAccessApplicationDetail }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const collection = application.deliveryMethod === 'collection';
  const who = application.representative?.name ?? application.declarant.fullName;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await markSelfAccessDelivered({
      data: { applicationId: application.id, idempotencyKey: key },
    }).catch((): Awaited<ReturnType<typeof markSelfAccessDelivered>> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      toast({ title: collection ? m.markedCollected : m.markedDispatched });
      await router.invalidate();
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    if (result.error.kind === 'problem') {
      // Marked by someone else, or no longer ready: show where it stands now.
      setOpen(false);
      toast({
        title: result.error.problem.status === 403 ? m.supervisorWaits : m.stale,
        urgency: 'assertive',
      });
      await router.invalidate();
      return;
    }
    setError(m.markFailed);
  };

  return (
    <>
      <Button
        onClick={() => {
          setKey(crypto.randomUUID());
          setError(null);
          setOpen(true);
        }}
      >
        <Icon icon={collection ? UserCheck01Icon : SentIcon} />
        {collection ? m.markCollected : m.markDispatched}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{collection ? m.markCollectedTitle : m.markDispatchedTitle}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <DialogDescription>
              {collection ? m.markCollectedBody(who) : m.markDispatchedBody(who)}
            </DialogDescription>
            {error ? (
              <Alert variant="destructive">
                <Icon icon={AlertCircleIcon} />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                {m.cancel}
              </Button>
            </DialogClose>
            <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
              {busy ? <Spinner className="size-4" /> : null}
              {collection ? m.markCollected : m.markDispatched}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
