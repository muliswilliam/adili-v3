import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  formatDateTime,
  formatScopeSections,
  formatScopeYears,
  groundMeta,
  Icon,
  Spinner,
} from '@adili/ui';
import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  Download01Icon,
  SquareLock02Icon,
  Timer02Icon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';

import type { LeaRequest } from '../../server/access/types';
import { Grid, Part, Value } from '../access/form-k-card';
import { scopePeople, scopeText } from '../access/format';
import { OutcomeLine, SideCard } from '../access/side-cards';
import { Page } from '../page';
import { messages as m } from './messages';
import { MineBadge } from './my-requests';
import { packageState, usePackageDownload } from './package';

const PACKAGE_POLL_MS = 3000;
const PACKAGE_POLLS = 20;

/**
 * One of the law enforcement officer's requests (spec 10 FE-6): what they asked, how far it got
 * (received, verified by the Commission, decided) and, on the right, the decision's deadline,
 * the denial with its grounds and reasons, or the package to download while its window is open.
 */
export function MyRequest({ request, now }: { request: LeaRequest; now: string }) {
  const { officerSought: sought, scope } = request;
  const state = packageState(request, Date.parse(now));
  usePackagePolling(state.kind === 'preparing');
  return (
    <Page>
      <div className="mb-[22px] min-w-0">
        <div className="mb-1.5">
          <MineBadge status={request.status} />
        </div>
        <h1 className="font-mono text-[22px] leading-tight font-semibold tracking-[-0.01em] min-[700px]:text-[24px]">
          {request.reference}
        </h1>
        <p className="mt-1 text-[14.5px] text-muted-foreground">
          {request.commission.name} · {m.caseLine}{' '}
          <span className="font-mono">{request.caseReference}</span>
        </p>
      </div>

      <div className="grid items-start gap-4 min-[1080px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-4">
          <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="your-request-title">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle id="your-request-title">{m.yourRequest}</CardTitle>
            </CardHeader>
            <div>
              <Part title={m.officerSought}>
                <Grid>
                  <Value term={m.name}>{sought.name}</Value>
                  <Value term={m.entity}>
                    {sought.entity?.trim() ? sought.entity : <NotGiven />}
                  </Value>
                  {sought.workStation ? (
                    <Value term={m.workStation}>{sought.workStation}</Value>
                  ) : null}
                  {sought.personnelFileNumber ? (
                    <Value term={m.personnelFileNumber}>
                      <span className="font-mono text-[13.5px]">{sought.personnelFileNumber}</span>
                    </Value>
                  ) : null}
                </Grid>
              </Part>
              <Part title={m.reasonForAccess}>
                <p className="text-[14.5px] leading-relaxed whitespace-pre-line">
                  {request.reason}
                </p>
              </Part>
              <Part title={m.scope}>
                <Grid>
                  <Value term={m.years}>{formatScopeYears(scope)}</Value>
                  <Value term={m.people}>{scopePeople(scope)}</Value>
                  <Value term={m.sections}>{formatScopeSections(scope)}</Value>
                </Grid>
              </Part>
            </div>
          </Card>
          <Progress request={request} />
        </div>
        <aside className="order-first grid min-w-0 gap-4 min-[1080px]:order-none">
          <Side request={request} now={now} />
        </aside>
      </div>
    </Page>
  );
}

function NotGiven() {
  return <span className="font-normal text-muted-foreground">{m.notGiven}</span>;
}

/** Received, verified by the Commission, decided: done steps ticked, the rest waiting. */
function Progress({ request }: { request: LeaRequest }) {
  const { decision } = request;
  const steps: { title: string; detail: string; done: boolean }[] = [
    { title: m.received, detail: formatDateTime(request.receivedAt), done: true },
    {
      title: m.verifiedByCommission,
      detail: request.verification ? formatDateTime(request.verification.at) : m.waiting,
      done: request.verification !== null,
    },
    {
      title: m.decision,
      detail: decision
        ? m.decidedAt(m.outcome[decision.outcome], formatDateTime(decision.decidedAt))
        : m.dueOn(formatDate(request.deadlineAt)),
      done: decision !== null,
    },
  ];
  // A denial can come before any verification: that step was never reached.
  const shown = decision && !request.verification ? steps.filter((_, index) => index !== 1) : steps;
  return (
    <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="progress-title">
      <CardHeader className="border-b px-5 py-4">
        <CardTitle id="progress-title">{m.progress}</CardTitle>
      </CardHeader>
      <ol className="grid gap-4 px-5 py-4.5" aria-labelledby="progress-title">
        {shown.map((step) => (
          <li key={step.title} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full',
                step.done ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon
                icon={step.done ? CheckmarkCircle02Icon : Clock01Icon}
                className="size-3.5"
                strokeWidth={2.2}
              />
            </span>
            <div className="grid gap-0.5">
              <span className={cn('text-sm font-medium', !step.done && 'text-muted-foreground')}>
                {step.title}
              </span>
              <span className="text-[13px] text-muted-foreground">{step.detail}</span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function Side({ request, now }: { request: LeaRequest; now: string }) {
  const router = useRouter();
  const { busy, download } = usePackageDownload(() => void router.invalidate());
  const { decision } = request;

  if (request.status === 'denied' && decision) {
    return (
      <SideCard id="decision" title={m.decisionTitle}>
        <OutcomeLine icon={UnavailableIcon} tone="destructive">
          {m.outcome.deny}
        </OutcomeLine>
        <dl className="grid gap-3 text-sm">
          {decision.grounds.length > 0 ? (
            <Item term={m.grounds}>
              <ul className="grid gap-0.5">
                {decision.grounds.map((ground) => (
                  <li key={ground}>{groundMeta[ground].label}</li>
                ))}
              </ul>
            </Item>
          ) : null}
          <div>
            <dt className="text-[13px] text-muted-foreground">{m.reasons}</dt>
            <dd className="mt-0.5 whitespace-pre-line">{decision.reasons}</dd>
          </div>
          <Item term={m.decided}>{formatDate(decision.decidedAt)}</Item>
        </dl>
      </SideCard>
    );
  }

  if (request.status === 'granted' && decision) {
    const state = packageState(request, Date.parse(now));
    const header = (
      <Badge variant="destructive">
        <Icon icon={SquareLock02Icon} strokeWidth={2.2} />
        {m.confidential}
      </Badge>
    );
    return (
      <>
        <SideCard id="package" title={m.packageTitle} actions={header}>
          {state.kind === 'preparing' ? (
            <p
              role="status"
              className="flex items-center gap-2.5 text-sm text-secondary-foreground"
            >
              <Spinner className="size-4" />
              {m.packagePreparing}
            </p>
          ) : null}
          {state.kind === 'missing' ? (
            <p className="rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground">
              {m.noPackage}
            </p>
          ) : null}
          {state.kind === 'closed' ? (
            <Alert variant="warning">
              <Icon icon={Timer02Icon} />
              <AlertDescription>{m.windowClosed(formatDate(state.until))}</AlertDescription>
            </Alert>
          ) : null}
          {state.kind === 'ready' ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <DeadlineChip
                  due={state.until}
                  soonDays={deadlineSoonDays.download}
                  label={m.downloadUntil}
                  todayText={m.endsToday}
                  now={Date.parse(now)}
                />
                <span className="text-[13.5px] text-muted-foreground">
                  {m.until(formatDate(state.until))}
                </span>
              </div>
              <Button
                disabled={busy !== null}
                aria-busy={busy !== null || undefined}
                onClick={() => void download(state.documentId)}
              >
                {busy ? <Spinner className="size-4" /> : <Icon icon={Download01Icon} />}
                {m.downloadPackage}
              </Button>
            </>
          ) : null}
          {state.kind === 'ready' || state.kind === 'closed' ? (
            <>
              <dl className="grid gap-3 text-sm">
                <Item term={m.issued}>{formatDateTime(state.issuedAt)}</Item>
                <Item term={m.yourDownloads}>{state.downloads}</Item>
              </dl>
              <p className="text-[13px] text-muted-foreground">{m.watermarked}</p>
            </>
          ) : null}
        </SideCard>
        <SideCard id="decision" title={m.decisionTitle}>
          <OutcomeLine icon={CheckmarkCircle02Icon} tone="success">
            {m.outcome[decision.outcome]}
          </OutcomeLine>
          <dl className="grid gap-3 text-sm">
            {decision.outcome === 'partial-grant' && decision.grantedScope ? (
              <Item term={m.grantedScope}>{scopeText(decision.grantedScope)}</Item>
            ) : null}
            <Item term={m.decided}>{formatDate(decision.decidedAt)}</Item>
          </dl>
        </SideCard>
      </>
    );
  }

  if (request.status === 'withdrawn') {
    return (
      <SideCard id="decision" title={m.decisionTitle}>
        <p className="text-sm text-muted-foreground">{m.withdrawn}</p>
      </SideCard>
    );
  }

  return (
    <SideCard
      id="decision"
      title={m.decisionTitle}
      actions={
        <DeadlineChip
          due={request.deadlineAt}
          soonDays={deadlineSoonDays.lawEnforcement}
          label={m.decisionDue}
        />
      }
    >
      <p className="text-sm text-muted-foreground">
        {request.status === 'verified' ? `${m.verifiedNote} ` : ''}
        {m.dueNote(formatDate(request.deadlineAt))}
      </p>
    </SideCard>
  );
}

/** While the package of a fresh grant is prepared, look again a few times. */
function usePackagePolling(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > PACKAGE_POLLS) {
        clearInterval(timer);
        return;
      }
      void router.invalidate();
    }, PACKAGE_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active, router]);
}
