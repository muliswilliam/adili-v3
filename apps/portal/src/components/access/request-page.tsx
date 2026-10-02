import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardTitle,
  cn,
  formatDateTime,
  formatTime,
  Icon,
  ProgressBar,
  ReferenceChip,
  type Tone,
} from '@adili/ui';
import {
  ArrowLeft01Icon,
  Building03Icon,
  Cancel01Icon,
  Copy01Icon,
  SquareLock02Icon,
  Tick02Icon,
  Undo02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import {
  day,
  PACKAGE_COPY as PACKAGE,
  REQUEST_COPY as COPY,
  STATUS_BANNERS,
  STATUSES,
} from '../../access/copy';
import { packageView, type PackageView, preparingEndsAt } from '../../access/package';
import { accessReferenceParts } from '../../access/reference';
import { decisionClock, requestStages, type Stage, WITHDRAWABLE } from '../../access/progress';
import type { AccessRequest } from '../../server/access/types';
import { PackageCard, usePackageClock, useWakeAt } from './package-card';
import { GroundsList, PartRow, PartRows, ScopeRows } from './request-parts';
import { RequestStatusBadge } from './request-status';

const ALERT_VARIANTS: Record<
  Tone,
  'neutral' | 'info' | 'success' | 'warning' | 'destructive' | 'brand'
> = {
  default: 'neutral',
  info: 'info',
  brand: 'info',
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
  ai: 'neutral',
};

/** When the date a status's banner names happened: receipt, due date or withdrawal. */
function bannerDate(request: AccessRequest): string {
  if (request.status === 'withdrawn') {
    const withdrawn = request.timeline.filter((entry) => entry.kind === 'withdrawn').at(-1);
    return day(withdrawn?.at ?? request.submittedAt);
  }
  if (request.status === 'under-decision') return day(request.decisionDeadlineAt);
  return day(request.submittedAt);
}

/** What comes after a grant's lead: download by when, being prepared, or the window closed. */
function packageNext(request: AccessRequest, pkg: PackageView): string {
  if (pkg.state === 'preparing') return PACKAGE.preparingNext;
  if (pkg.state === 'missing') return PACKAGE.missingNext;
  if (pkg.state === 'expired') return PACKAGE.closedNext(day(pkg.package.downloadExpiresAt));
  const at = pkg.package.downloadExpiresAt;
  const partial = request.status === 'partially-granted';
  if (pkg.daysLeft === 0) {
    return (partial ? PACKAGE.partialReadyTodayNext : PACKAGE.readyTodayNext)(formatTime(at));
  }
  // The date and time wrap as one, never "14 / Oct 2026".
  const unbroken = formatDateTime(at).replaceAll(' ', '\u00a0');
  return (partial ? PACKAGE.partialReadyNext : PACKAGE.readyNext)(unbroken);
}

function StatusBanner({
  request,
  pkg,
  windowClosed,
}: {
  request: AccessRequest;
  pkg: PackageView | null;
  /** The documents service has just said the window is closed. */
  windowClosed: boolean;
}) {
  const meta = STATUSES[request.status];
  const banner = STATUS_BANNERS[request.status];
  const date = bannerDate(request);
  const name = request.commission.name;
  if (windowClosed) {
    return (
      <Alert variant="neutral" role="status" className="gap-2.5">
        <Icon icon={SquareLock02Icon} />
        <AlertDescription>
          <strong className="font-semibold">{PACKAGE.closedNowLead}</strong> {PACKAGE.closedNowNext}
        </AlertDescription>
      </Alert>
    );
  }
  const expired = pkg?.state === 'expired';
  return (
    <Alert
      variant={expired ? 'neutral' : ALERT_VARIANTS[meta.tone]}
      role="status"
      className="gap-2.5"
    >
      <Icon icon={expired ? SquareLock02Icon : meta.icon} />
      <AlertDescription>
        <strong className="font-semibold">{banner.lead.en(name, date)}</strong>{' '}
        {pkg ? packageNext(request, pkg) : banner.next.en(name, date)}
      </AlertDescription>
      {request.status === 'cannot-identify' ? (
        <div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/access/requests/new" search={{ from: request.id }}>
              <Icon icon={Copy01Icon} />
              {COPY.newWithDetails}
            </Link>
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}

function DecisionCard({ request }: { request: AccessRequest }) {
  const { decision } = request;
  if (!decision) return null;
  return (
    <Card className="gap-4">
      <CardTitle>{COPY.decision}</CardTitle>
      <PartRows>
        <PartRow term={COPY.outcome}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={request.status} />
            <span className="text-muted-foreground">{day(decision.decidedAt)}</span>
          </span>
        </PartRow>
        {decision.grounds.length > 0 ? (
          <PartRow term={COPY.grounds}>
            <GroundsList grounds={decision.grounds} />
          </PartRow>
        ) : null}
        <PartRow term={COPY.reasons}>{decision.reasons}</PartRow>
      </PartRows>
      {decision.grantedScope && request.status === 'partially-granted' ? (
        <div className="grid gap-2 border-t border-border pt-4">
          <p className="text-[13.5px] font-medium">{COPY.grantedScope}</p>
          <ScopeRows scope={decision.grantedScope} />
        </div>
      ) : null}
      {request.status === 'denied' ? (
        <p className="border-t border-border pt-4 text-[14.5px] text-secondary-foreground">
          {COPY.courtRelief}
        </p>
      ) : null}
    </Card>
  );
}

function YourRequest({ request }: { request: AccessRequest }) {
  const { partII, partIII, scope } = request.formK;
  return (
    <Card className="gap-0 p-0 sm:p-0">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <CardTitle>{COPY.yourRequest}</CardTitle>
      </div>
      <div className="grid gap-5 px-5 py-5 sm:px-6">
        <PartRows>
          <PartRow term={COPY.officer}>{partII.name}</PartRow>
          <PartRow term={COPY.entity}>{partII.entity}</PartRow>
          {partII.workStation ? (
            <PartRow term={COPY.workStation}>{partII.workStation}</PartRow>
          ) : null}
          {partII.personnelFileNumber ? (
            <PartRow term={COPY.fileNumber}>{partII.personnelFileNumber}</PartRow>
          ) : null}
          <PartRow term={COPY.informationSought}>{partIII.informationSought}</PartRow>
          <PartRow term={COPY.reason}>{partIII.reason}</PartRow>
          {partIII.otherInformation ? (
            <PartRow term={COPY.otherInformation}>{partIII.otherInformation}</PartRow>
          ) : null}
        </PartRows>
        <div className="grid gap-2.5 border-t border-border pt-5">
          <p className="text-[13.5px] font-medium">{COPY.scope}</p>
          <ScopeRows scope={scope} />
        </div>
      </div>
    </Card>
  );
}

function DecisionClockCard({ request, now }: { request: AccessRequest; now: number }) {
  const clock = decisionClock(request, now);
  if (!clock) return null;
  const late = clock.state === 'late';
  const soon = clock.state === 'soon' || clock.state === 'today';
  return (
    <Card className="gap-3">
      <p
        className={cn(
          'text-[20px] leading-tight font-semibold tracking-[-0.01em]',
          late ? 'text-destructive' : soon ? 'text-warning' : null,
        )}
      >
        {late ? COPY.decisionLate(-clock.daysLeft) : COPY.decisionDueIn(clock.daysLeft)}
      </p>
      <p className="-mt-2 text-[13.5px] text-muted-foreground">
        {COPY.decisionDayOf(day(request.decisionDeadlineAt), clock.day, clock.of)}
      </p>
      <ProgressBar
        label={COPY.decisionClock}
        value={clock.day}
        max={clock.of}
        size="sm"
        showValue={false}
        tone={late ? 'destructive' : 'default'}
        valueText={COPY.decisionDayOf(day(request.decisionDeadlineAt), clock.day, clock.of)}
      />
      <p
        aria-hidden="true"
        className="-mt-1 flex justify-between text-[12.5px] text-muted-foreground"
      >
        <span>{day(request.submittedAt)}</span>
        <span>{day(request.decisionDeadlineAt)}</span>
      </p>
    </Card>
  );
}

function StageMark({ stage }: { stage: Stage }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative z-[1] grid size-6 shrink-0 place-items-center rounded-full',
        stage.state === 'done' && 'bg-success-subtle text-success',
        stage.state === 'current' && 'bg-primary text-primary-foreground',
        stage.state === 'upcoming' && 'bg-card inset-ring-[1.5px] inset-ring-input',
        stage.state === 'stopped' && 'bg-destructive-subtle text-destructive',
        stage.state === 'ended' && 'bg-muted text-secondary-foreground',
      )}
    >
      {stage.state === 'done' ? (
        <Icon icon={Tick02Icon} strokeWidth={3} className="size-3" />
      ) : stage.state === 'stopped' ? (
        <Icon icon={Cancel01Icon} strokeWidth={2.6} className="size-3" />
      ) : stage.state === 'ended' ? (
        <Icon icon={Undo02Icon} strokeWidth={2.4} className="size-3" />
      ) : stage.state === 'current' ? (
        <span className="size-1.5 rounded-full bg-primary-foreground" />
      ) : null}
    </span>
  );
}

const STAGE_WORDS: Record<Stage['state'], string> = {
  done: 'done',
  current: 'now',
  upcoming: 'to come',
  stopped: 'stopped',
  ended: 'ended',
};

function Progress({
  request,
  now,
  windowClosed,
}: {
  request: AccessRequest;
  now: number;
  windowClosed: boolean;
}) {
  const stages = requestStages(request, now, windowClosed);
  return (
    <ol className="grid">
      {stages.map((stage, index) => (
        <li key={stage.id} className="relative flex gap-3 pb-4 last:pb-0">
          {index < stages.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-6 bottom-0 left-[11.25px] w-[1.5px] bg-border"
            />
          ) : null}
          <StageMark stage={stage} />
          <span className="grid min-w-0 gap-0.5 pt-0.5">
            <span
              className={cn(
                'text-[14.5px] leading-tight font-medium',
                stage.state === 'upcoming' && 'text-muted-foreground',
              )}
            >
              {stage.title}
              <span className="sr-only">, {STAGE_WORDS[stage.state]}</span>
            </span>
            {stage.detail ? (
              <span className="text-[12.5px] text-muted-foreground">{stage.detail}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One of the applicant's Form K requests (spec 10 FE-3): where it stands, the decision clock,
 * its progress, what was asked and, once decided, the decision with its reasons and grounds
 * and, for a grant, the package to download until its window ends (#261). Withdrawing is
 * offered until a decision.
 */
export function RequestPage({
  request,
  now: serverNow,
  onWithdraw,
  onDownloaded,
}: {
  request: AccessRequest;
  /** Epoch milliseconds from the server. */
  now: number;
  onWithdraw: () => void;
  /** A package download started: the request's downloads have changed. */
  onDownloaded: () => void;
}) {
  const withdrawable = WITHDRAWABLE.has(request.status);
  const clock = usePackageClock(serverNow, request.package?.downloadExpiresAt ?? null);
  // A package not issued an hour after the grant stops reading as being prepared.
  const now = useWakeAt(clock, preparingEndsAt(request));
  const [windowClosed, setWindowClosed] = useState(false);
  const pkg = packageView(request, now, windowClosed);
  return (
    <main className="mx-auto grid w-full max-w-[1000px] flex-1 content-start gap-6 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
      <div className="grid gap-3">
        <Button asChild variant="ghost" size="sm" className="justify-self-start">
          <Link to="/access/requests" search={{}}>
            <Icon icon={ArrowLeft01Icon} />
            {COPY.back}
          </Link>
        </Button>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
          {request.formK.partII.name}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ReferenceChip
            reference={request.reference}
            parts={accessReferenceParts(request.commission.name)}
            size="sm"
          />
          <RequestStatusBadge status={request.status} />
          <span className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground [&_svg]:size-4">
            <Icon icon={Building03Icon} />
            {request.commission.name}
          </span>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-5">
          <StatusBanner request={request} pkg={pkg} windowClosed={windowClosed} />
          {pkg ? (
            <PackageCard
              view={pkg}
              applicantName={request.formK.partI.name}
              reference={request.reference}
              commission={request.commission.name}
              onWindowClosed={() => {
                setWindowClosed(true);
              }}
              onDownloaded={onDownloaded}
            />
          ) : null}
          <DecisionCard request={request} />
          <YourRequest request={request} />
        </div>
        <div className="grid gap-5">
          <DecisionClockCard request={request} now={now} />
          <Card className="gap-4 p-0 sm:p-0">
            <div className="grid gap-4 px-5 pt-5 sm:px-6">
              <CardTitle>{COPY.progress}</CardTitle>
              <Progress request={request} now={now} windowClosed={windowClosed} />
            </div>
            {withdrawable ? (
              <div className="border-t border-border px-3 py-2.5 sm:px-4">
                <Button type="button" variant="destructive-ghost" size="sm" onClick={onWithdraw}>
                  <Icon icon={Undo02Icon} />
                  {COPY.withdraw}
                </Button>
              </div>
            ) : (
              <div className="pb-1" />
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
