import {
  Badge,
  Button,
  Card,
  CardTitle,
  cn,
  formatDate,
  formatDateTime,
  Icon,
  IconTile,
  msUntilKenyanMidnight,
  Spinner,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  Clock01Icon,
  Download01Icon,
  PackageRemoveIcon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useId, useState } from 'react';

import { PACKAGE_COPY as COPY } from '../../access/copy';
import {
  COUNTDOWN_FROM_MS,
  countdownSpoken,
  countdownText,
  type PackageView,
} from '../../access/package';
import { getMyPackageDownload } from '../../server/access-requests';
import { downloadFrom } from '../download';

/** The longest delay setTimeout keeps (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The clock a package's window is read against: the server's `now` for the first render (so
 * server and browser render alike), then the browser's, ticking every second in the window's
 * last day, and otherwise waking at each Kenyan midnight (days left change) and when the last
 * day starts. Stops once the window has ended.
 */
export function usePackageClock(serverNow: number, expiresAt: string | null): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!expiresAt) return;
    const end = Date.parse(expiresAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = end - current;
      if (left <= 0) return;
      const wait =
        left <= COUNTDOWN_FROM_MS
          ? Math.min(left, 1000 - (current % 1000))
          : Math.min(left - COUNTDOWN_FROM_MS, msUntilKenyanMidnight(current), MAX_TIMEOUT_MS);
      timer = setTimeout(tick, wait);
    };
    tick();
    return () => {
      clearTimeout(timer);
    };
  }, [expiresAt]);
  return now;
}

/**
 * A thumbnail of a watermarked page, a sheet on the card's own paper: the mark names the
 * applicant, reference and issue date.
 */
function WatermarkedPage({
  name,
  reference,
  issuedAt,
  off,
}: {
  name: string;
  reference: string;
  issuedAt: string;
  off: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative hidden h-[120px] w-[92px] shrink-0 overflow-hidden rounded-lg bg-card shadow-card sm:block',
        off && 'opacity-50 grayscale',
      )}
    >
      <span className="absolute top-2 left-3 text-[6.5px] font-bold tracking-[0.08em] text-destructive">
        CONFIDENTIAL
      </span>
      {[20, 30, 38, 46, 76, 84, 92, 100].map((top, index) => (
        <span
          key={top}
          className={cn(
            'absolute left-3 h-1 rounded-full bg-muted',
            index % 3 === 2 ? 'right-[34px]' : 'right-3',
          )}
          style={{ top }}
        />
      ))}
      <span className="absolute top-[42px] -right-5 -left-5 -rotate-[32deg] text-center text-[6.5px] leading-[1.35] font-semibold tracking-[0.02em] text-destructive/45">
        {name}
        <br />
        {reference}
        <br />
        {formatDate(issuedAt)}
      </span>
    </div>
  );
}

function DownloadsLine({ view }: { view: Extract<PackageView, { package: unknown }> }) {
  const times = view.package.downloads;
  return (
    <p className="text-[13px] text-muted-foreground">
      {times > 0 && view.lastDownloadAt
        ? COPY.downloaded(times, formatDateTime(view.lastDownloadAt))
        : COPY.notDownloaded}
    </p>
  );
}

/**
 * When the window ends: the date and days left, or a live countdown in its last day. `id` names
 * it, so the Download button is described by it.
 */
function ExpiryLine({ id, view }: { id: string; view: Extract<PackageView, { state: 'ready' }> }) {
  if (view.msLeft > COUNTDOWN_FROM_MS) {
    return (
      <span
        id={id}
        className={cn(
          'inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground tabular-nums [&_svg]:size-[15px]',
          view.daysLeft <= 3 && 'font-semibold text-warning',
        )}
      >
        <Icon icon={Clock01Icon} />
        {COPY.expiresOn(formatDateTime(view.package.downloadExpiresAt), view.daysLeft)}
      </span>
    );
  }
  return (
    <>
      {/* Ticks each minute on screen; screen readers hear the coarse steps below instead. */}
      <span
        aria-hidden="true"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-warning tabular-nums [&_svg]:size-[15px]"
      >
        <Icon icon={Clock01Icon} />
        {COPY.expiresIn(countdownText(view.msLeft))}
      </span>
      <span id={id} className="sr-only" aria-live="polite">
        {countdownSpoken(view.msLeft)}
      </span>
    </>
  );
}

function ReadyActions({
  view,
  onWindowClosed,
  onDownloaded,
}: {
  view: Extract<PackageView, { state: 'ready' }>;
  onWindowClosed: () => void;
  onDownloaded: () => void;
}) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const expiryId = useId();
  const { documentId } = view.package;

  async function download() {
    setPending(true);
    setFailed(false);
    const link = await getMyPackageDownload({ data: { documentId } }).catch(() => null);
    setPending(false);
    if (link?.status === 'ok') {
      downloadFrom(link.downloadUrl);
      toast({ title: COPY.downloadStarted });
      onDownloaded();
    } else if (link?.status === 'window-closed') {
      onWindowClosed();
    } else {
      setFailed(true);
    }
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <Button
          type="button"
          disabled={pending}
          aria-busy={pending}
          aria-describedby={expiryId}
          className="max-sm:flex-1"
          onClick={() => void download()}
        >
          {/* The label stays, so the expiry beside it does not move while the link comes. */}
          {pending ? <Spinner /> : <Icon icon={Download01Icon} />}
          {COPY.download}
        </Button>
        <ExpiryLine id={expiryId} view={view} />
      </div>
      {failed ? (
        <p
          role="alert"
          className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-destructive [&_svg]:size-4"
        >
          <Icon icon={AlertCircleIcon} />
          {COPY.downloadFailed}
        </p>
      ) : null}
      <DownloadsLine view={view} />
    </div>
  );
}

/**
 * A granted request's package (spec 10, #261, decision 1): being prepared; failed to issue (the
 * access service says so); ready, with Download (a link fetched from documents on each click),
 * when the window ends and, in its last day, a live countdown screen readers hear at coarse
 * steps; or expired. A 410 from documents closes the window on the page (`onWindowClosed`). When
 * the granted scope held no declaration, what is downloaded is the nil letter, saying so, in
 * place of the package. Every page carries the applicant's name and the reference; sharing a
 * package is an offence (Act s.36(4)).
 */
export function PackageCard({
  view,
  applicantName,
  officerName,
  reference,
  commission,
  onWindowClosed,
  onDownloaded,
}: {
  view: PackageView;
  applicantName: string;
  /** The officer the request named, whom a nil letter says no declarations are held by. */
  officerName: string;
  reference: string;
  commission: string;
  onWindowClosed: () => void;
  onDownloaded: () => void;
}) {
  if (view.state === 'failed') {
    return (
      <Card className="p-0 sm:p-0">
        <div role="status" className="flex items-start gap-3.5 px-5 py-[22px] sm:px-6">
          <IconTile aria-hidden="true" tone="warning">
            <Icon icon={PackageRemoveIcon} />
          </IconTile>
          <div className="grid gap-0.5">
            <p className="font-semibold">{COPY.failedTitle}</p>
            <p className="text-sm text-muted-foreground">{COPY.failedText(commission)}</p>
          </div>
        </div>
      </Card>
    );
  }
  if (view.state === 'preparing') {
    return (
      <Card className="p-0 sm:p-0">
        <div role="status" className="flex items-start gap-3.5 px-5 py-[22px] sm:px-6">
          <Spinner className="mt-0.5 text-foreground" />
          <div className="grid gap-0.5">
            <p className="font-semibold">{COPY.preparingTitle}</p>
            <p className="text-sm text-muted-foreground">{COPY.preparingText}</p>
          </div>
        </div>
      </Card>
    );
  }
  const expired = view.state === 'expired';
  const nil = view.package.kind === 'nil-letter';
  return (
    <Card className="gap-0 p-0 sm:p-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
        <CardTitle className="flex-1">{nil ? COPY.nilLetterTitle : COPY.title}</CardTitle>
        <Badge variant="destructive">
          <Icon icon={SquareLock02Icon} strokeWidth={2.2} />
          {COPY.confidential}
        </Badge>
      </div>
      <div className="flex items-start gap-[18px] px-5 py-5 sm:px-6">
        <WatermarkedPage
          name={applicantName}
          reference={reference}
          issuedAt={view.package.issuedAt}
          off={expired}
        />
        <div className="grid min-w-0 flex-1 gap-3.5">
          {nil ? (
            <div className="grid gap-1 text-pretty">
              <p className="font-semibold">{COPY.nilLetterStatement}</p>
              <p className="text-[13.5px] text-muted-foreground">
                {COPY.nilLetterText(commission, officerName)}
              </p>
              <p className="text-[13.5px] text-muted-foreground">
                {COPY.issuedOn(formatDate(view.package.issuedAt))} {COPY.watermarked}
              </p>
            </div>
          ) : (
            <div className="grid gap-0.5">
              <p className="font-medium">{COPY.issuedOn(formatDate(view.package.issuedAt))}</p>
              <p className="text-[13.5px] text-muted-foreground">{COPY.watermarked}</p>
            </div>
          )}
          {view.state === 'ready' ? (
            <ReadyActions view={view} onWindowClosed={onWindowClosed} onDownloaded={onDownloaded} />
          ) : (
            <div className="grid gap-2.5">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
                <Badge variant="default">
                  <Icon icon={SquareLock02Icon} strokeWidth={2.2} />
                  {COPY.expiredOn(formatDate(view.package.downloadExpiresAt))}
                </Badge>
                <DownloadsLine view={view} />
              </div>
              <p className="text-[13.5px] text-muted-foreground">{COPY.stillNeed(commission)}</p>
            </div>
          )}
        </div>
      </div>
      {nil ? null : (
        <div className="flex items-start gap-2 border-t border-border px-5 py-3 text-[13px] text-secondary-foreground sm:px-6 [&_svg]:mt-px [&_svg]:size-[15px] [&_svg]:shrink-0">
          <Icon icon={Alert02Icon} />
          <span>{COPY.offence(commission)}</span>
        </div>
      )}
    </Card>
  );
}
