import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  formatDateTime,
  formatScopeSections,
  formatScopeYears,
  Icon,
  InfoTip,
  RegisterTimeline,
} from '@adili/ui';
import {
  Alert02Icon,
  JusticeScale01Icon,
  Undo02Icon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { LeaRequest } from '../../../server/access/types';
import { ReadOnlyBadge } from '../../commissions/badges';
import { Page } from '../../page';
import { usePollWhile } from '../../use-poll-while';
import { Grid, NotGiven, Part, Value } from '../form-k-card';
import { scopePeople } from '../format';
import { StatusBadge } from '../queue-list';
import { Muted, OutcomeLine, SideCard, WaitingCard } from '../side-cards';
import { DecidedCard } from '../decision/decided-card';
import { PackageCard, usePackageState } from '../decision/package-card';
import { isBreached, isOpenLea, leaStep, leaTimelineOf } from './lea-view';
import { messages as m } from './messages';
import { LeaVerifyCard } from './verify-card';

/** How often, and how many times, the page looks again while a granted package is prepared. */
const PACKAGE_POLL_MS = 2000;
const PACKAGE_POLLS = 30;

/**
 * A law enforcement request as its Commission's access officer works it and its supervisor reads
 * it (spec 10 FE-6, S11): the written request (no Form K) and the access register on the left;
 * on the right the step it is at (verify, then decide), the decision and its package, and the
 * verification. A line on top says who has been told: never the declarant (product decision,
 * 2026-10-05; #614).
 */
export function LeaRequestDetail({
  request,
  readOnly,
  now,
}: {
  request: LeaRequest;
  readOnly: boolean;
  now: string;
}) {
  const step = leaStep(request, readOnly);
  const open = isOpenLea(request);
  const breached = isBreached(request, now);
  const pkg = usePackageState(
    request.status === 'granted' ? request.decision : null,
    request.package,
    request.packageFailedAt,
    request.timeline.filter((entry) => entry.kind === 'downloaded').map((entry) => entry.at),
    now,
  );
  usePollWhile(pkg?.state === 'preparing', PACKAGE_POLL_MS, PACKAGE_POLLS);

  return (
    <Page>
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={request.status} />
            <Badge>{m.lawEnforcement}</Badge>
            {breached ? (
              <Badge variant="destructive">
                <Icon icon={Alert02Icon} strokeWidth={2.4} />
                {m.breached}
              </Badge>
            ) : null}
            {readOnly ? <ReadOnlyBadge /> : null}
          </div>
          <h1 className="font-mono text-[22px] leading-tight font-semibold tracking-[-0.01em] min-[700px]:text-[24px]">
            {request.reference}
          </h1>
          <p className="mt-1 text-[14.5px] text-muted-foreground">
            {m.receivedLine(request.agency.name, formatDate(request.receivedAt))}
          </p>
        </div>
        {open ? (
          <div className="ml-auto flex items-center gap-2.5 pt-1">
            <DeadlineChip
              due={request.deadlineAt}
              soonDays={deadlineSoonDays.lawEnforcement}
              label={m.decisionDue}
              late={breached}
            />
            <span className="text-[13.5px] text-muted-foreground">
              {m.decisionDueOn(formatDate(request.deadlineAt))}
            </span>
          </div>
        ) : null}
      </div>

      <WhoIsTold request={request} />

      <div className="grid items-start gap-4 min-[1080px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-4">
          <WrittenRequestCard request={request} />
          <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="register-title">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle id="register-title">{m.registerTitle}</CardTitle>
            </CardHeader>
            <div className="px-5 py-4.5">
              <RegisterTimeline entries={leaTimelineOf(request)} label={m.registerLabel} />
            </div>
          </Card>
        </div>
        <aside
          className="order-first grid min-w-0 gap-4 min-[1080px]:order-none"
          aria-label={m.whereItStands}
        >
          {step.kind === 'verify' ? <LeaVerifyCard request={request} /> : null}
          {step.kind === 'waiting' ? <WaitingCard text={step.text} /> : null}
          {step.kind === 'decide' ? <DecideCard request={request} readOnly={readOnly} /> : null}
          {step.kind === 'withdrawn' ? <WithdrawnCard request={request} /> : null}
          {request.decision ? <DecidedCard decision={request.decision} /> : null}
          {pkg ? (
            <PackageCard
              state={pkg}
              recipientName={`${request.officer.name}, ${request.agency.code}`}
              reference={request.reference}
            />
          ) : null}
          <VerificationCard request={request} />
        </aside>
      </div>
    </Page>
  );
}

/**
 * Who knows of the request: the agency hears of the decision; the declarant never hears of a law
 * enforcement request (product decision, 2026-10-05; #614).
 */
function WhoIsTold({ request }: { request: LeaRequest }) {
  return (
    <Alert role="status" className="mb-4">
      <Icon icon={ViewOffSlashIcon} />
      <AlertDescription>
        {request.status === 'denied'
          ? m.notToldDenied(request.agency.code)
          : request.status === 'withdrawn'
            ? m.notToldWithdrawn
            : m.neverTold}
      </AlertDescription>
    </Alert>
  );
}

/** Withdrawn by the officer who filed it, before a decision (user decision 5): closed. */
function WithdrawnCard({ request }: { request: LeaRequest }) {
  const withdrawn = request.timeline.find((entry) => entry.kind === 'withdrawn');
  return (
    <SideCard id="closed" title={m.closedTitle}>
      <OutcomeLine icon={Undo02Icon} tone="default">
        {m.withdrawnOutcome}
      </OutcomeLine>
      {withdrawn ? (
        <p className="text-sm text-muted-foreground">
          {m.withdrawnBy(request.officer.name, request.agency.code, formatDateTime(withdrawn.at))}
        </p>
      ) : null}
    </SideCard>
  );
}

/** The agency's written request (r.23(1)): who wrote, the case, the officer sought, why, what. */
export function WrittenRequestCard({ request }: { request: LeaRequest }) {
  const { officerSought: sought, scope } = request;
  return (
    <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="written-request-title">
      <CardHeader className="flex-row flex-wrap items-center gap-2 border-b px-5 py-4">
        <CardTitle id="written-request-title">{m.writtenRequest}</CardTitle>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {m.noFormK}
          <InfoTip label={m.noFormKTipLabel} content={m.noFormKTip} />
        </span>
      </CardHeader>
      <div>
        <Part title={m.requestedBy}>
          <Grid>
            <Value term={m.agency}>
              {request.agency.name}
              <div className="mt-0.5 text-[13px] font-normal text-muted-foreground">
                {request.provenance.agencyLegalBasis}
              </div>
            </Value>
            <Value term={m.requestingOfficer}>{request.officer.name}</Value>
            <Value term={m.caseReference}>
              <span className="font-mono text-[13.5px]">{request.caseReference}</span>
            </Value>
          </Grid>
        </Part>
        <Part title={m.officerSought}>
          <Grid>
            <Value term={m.name}>{sought.name}</Value>
            <Value term={m.entity}>{sought.entity?.trim() ? sought.entity : <NotGiven />}</Value>
            <Value term={m.workStation}>
              {sought.workStation?.trim() ? sought.workStation : <NotGiven />}
            </Value>
            <Value term={m.personnelFileNumber}>
              {sought.personnelFileNumber ? (
                <span className="font-mono text-[13.5px]">{sought.personnelFileNumber}</span>
              ) : (
                <NotGiven />
              )}
            </Value>
          </Grid>
        </Part>
        <Part title={m.reasonForAccess}>
          <p className="text-[14.5px] leading-relaxed whitespace-pre-line">{request.reason}</p>
        </Part>
        <Part title={m.scopeRequested}>
          <Grid>
            <Value term={m.years}>{formatScopeYears(scope)}</Value>
            <Value term={m.people}>{scopePeople(scope)}</Value>
            <Value term={m.sections}>{formatScopeSections(scope)}</Value>
          </Grid>
        </Part>
      </div>
    </Card>
  );
}

/** Verified: the access officer decides; the supervisor only reads. */
function DecideCard({ request, readOnly }: { request: LeaRequest; readOnly: boolean }) {
  return (
    <SideCard id="decision" title={m.decisionTitle}>
      {readOnly ? (
        <Muted>{m.decisionReadOnly}</Muted>
      ) : (
        <Button asChild>
          <Link
            to="/access/lea-requests/$leaRequestId/decide"
            params={{ leaRequestId: request.id }}
          >
            <Icon icon={JusticeScale01Icon} />
            {m.decide}
          </Link>
        </Button>
      )}
    </SideCard>
  );
}

/** Who verified it, when and what they noted, and the officer they identified. */
function VerificationCard({ request }: { request: LeaRequest }) {
  const { verification } = request;
  if (!verification) return null;
  return (
    <SideCard id="verification" title={m.verificationTitle}>
      <dl className="grid gap-3.5 text-sm">
        <div>
          <dt className="text-[13px] text-muted-foreground">{m.verifiedLabel}</dt>
          <dd className="mt-0.5 font-medium">
            {verification.by ? `${verification.by.name} · ` : null}
            {formatDateTime(verification.at)}
          </dd>
          {verification.note ? (
            <dd className="mt-0.5 text-[13px] whitespace-pre-line text-muted-foreground">
              {verification.note}
            </dd>
          ) : null}
        </div>
        {request.resolvedName ? (
          <div>
            <dt className="text-[13px] text-muted-foreground">{m.officerIdentified}</dt>
            <dd className="mt-0.5 text-[15px] font-semibold">{request.resolvedName}</dd>
          </div>
        ) : null}
      </dl>
    </SideCard>
  );
}
