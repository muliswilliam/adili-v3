import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  formatDate,
  formatDateTime,
  Icon,
  ProgressBar,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Download01Icon,
  File02Icon,
  InformationCircleIcon,
  Link01Icon,
  Message01Icon,
  Notification01Icon,
  SentIcon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, type RefObject, useRef, useState } from 'react';

import { COPY, REQUIREMENTS, STATUSES } from '../../clarification/copy';
import { countdown, isOpen, lateDays, reminderSent } from '../../clarification/deadline';
import { checkResponse } from '../../clarification/response-form';
import { historyOf, periodOf } from '../../clarification/view';
import { respondToMyClarification } from '../../server/clarifications';
import type { ClarificationLink } from '../../server/clarifications.server';
import type { DeclarantClarification } from '../../server/review/types';
import {
  ConfirmResponseDialog,
  PointAnswer,
  type ResponseFormState,
  SubmitBar,
  type SubmitError,
  useResponseForm,
} from './response-form';
import { loginHref } from '../sign-in';

/**
 * A clarification as the declarant sees it (spec 07a FE-5, S14, S20): what the Commission asks
 * point by point, the response form while it is open (overdue included: a late response is
 * accepted and marked late), the response once sent, the letter, the response period and the
 * history. Every status has its banner: reminder, overdue, responded (on time or late), further
 * clarification, resolved and withdrawn.
 */

export interface ClarificationPageProps {
  clarification: DeclarantClarification;
  followUps: ClarificationLink[];
  original: ClarificationLink | null;
  /** The server's clock when the page loaded. */
  now: string;
}

export function ClarificationPage(props: ClarificationPageProps) {
  // A sent response replaces the loaded clarification without a reload.
  const [clarification, setClarification] = useState(props.clarification);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const open = isOpen(clarification.status);
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
        <Link to="/">
          <Icon icon={ArrowLeft01Icon} />
          {COPY.back}
        </Link>
      </Button>
      <Header clarification={clarification} headingRef={headingRef} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-4">
          {open ? (
            <OpenClarification
              key={clarification.id}
              clarification={clarification}
              original={props.original}
              now={props.now}
              onResponded={(responded) => {
                setClarification(responded);
                // The form is gone: take focus (and the view) back to the top of the page.
                requestAnimationFrame(() => headingRef.current?.focus());
              }}
            />
          ) : (
            <>
              <Banners {...props} clarification={clarification} conflict={false} />
              <Points clarification={clarification} form={null} />
            </>
          )}
        </div>
        <aside className="grid content-start gap-4">
          <PeriodCard clarification={clarification} now={props.now} />
          <LetterCard clarification={clarification} />
          <HistoryCard clarification={clarification} followUps={props.followUps} now={props.now} />
        </aside>
      </div>
    </main>
  );
}

function Header({
  clarification,
  headingRef,
}: {
  clarification: DeclarantClarification;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const status = STATUSES[clarification.status];
  return (
    <div className="grid gap-2">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight outline-none"
      >
        {COPY.title(clarification.followUpOf !== null)}
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        <span className="font-mono text-foreground">{clarification.reference}</span>
        <Badge variant={status.variant}>{status.label.en}</Badge>
        {clarification.responseLate ? <Badge variant="warning">Late</Badge> : null}
        <span>{clarification.commission.name}</span>
        <span>
          {COPY.declaration} <span className="font-mono">{clarification.declarationReference}</span>
        </span>
      </div>
    </div>
  );
}

function OpenClarification({
  clarification,
  original,
  now,
  onResponded,
}: {
  clarification: DeclarantClarification;
  original: ClarificationLink | null;
  now: string;
  onResponded: (clarification: DeclarantClarification) => void;
}) {
  const state = useResponseForm(clarification.items.length);
  const { toast } = useToast();
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [confirming, setConfirming] = useState(false);
  // When the declarant confirms, not when the page loaded: the page may sit open past the due date.
  const [confirmAt, setConfirmAt] = useState(now);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SubmitError>(null);
  const [conflict, setConflict] = useState(false);
  const pointsRef = useRef<HTMLDivElement>(null);
  const signInHref = loginHref(`/clarifications/${clarification.id}`);

  function focusPoint(index: number) {
    const field = pointsRef.current?.querySelector<HTMLTextAreaElement>(
      `#point-${String(index + 1)}-response`,
    );
    field?.focus();
  }

  function submit() {
    state.dispatch({ type: 'tried' });
    setError(null);
    const check = checkResponse(state.form);
    switch (check.status) {
      case 'unanswered':
        toast({ title: COPY.unanswered(check.index + 1), urgency: 'assertive' });
        focusPoint(check.index);
        return;
      case 'files-checking':
        toast({ title: COPY.filesStillChecking });
        return;
      case 'files-not-accepted':
        toast({ title: COPY.filesNotAccepted, urgency: 'assertive' });
        return;
      case 'ready':
        setConfirmAt(new Date().toISOString());
        setConfirming(true);
    }
  }

  async function send() {
    const check = checkResponse(state.form);
    if (check.status !== 'ready') return;
    setSending(true);
    let result;
    try {
      result = await respondToMyClarification({
        data: { clarificationId: clarification.id, idempotencyKey, items: check.items },
      });
    } catch {
      result = { status: 'unavailable' } as const;
    }
    setSending(false);
    setConfirming(false);
    switch (result.status) {
      case 'responded':
        onResponded(result.clarification);
        toast({ title: COPY.sent });
        return;
      case 'conflict':
        if (result.reason === 'attachment-not-clean') {
          toast({ title: COPY.attachmentNotClean, urgency: 'assertive' });
        } else if (result.reason === 'not-open') {
          toast({ title: COPY.closedNow });
          void router.invalidate();
        } else {
          setConflict(true);
        }
        return;
      case 'unauthenticated':
        setError('signed-out');
        return;
      default:
        setError('network');
    }
  }

  return (
    <>
      <Banners
        clarification={clarification}
        followUps={[]}
        original={original}
        now={now}
        conflict={conflict}
      />
      <div ref={pointsRef}>
        <Points
          clarification={clarification}
          form={conflict ? null : state}
          footer={
            conflict ? null : (
              <SubmitBar
                form={state.form}
                points={clarification.items.length}
                error={error}
                signInHref={signInHref}
                onSubmit={submit}
              />
            )
          }
        />
      </div>
      <ConfirmResponseDialog
        open={confirming}
        busy={sending}
        clarification={clarification}
        form={state.form}
        now={confirmAt}
        onOpenChange={setConfirming}
        onConfirm={() => void send()}
      />
    </>
  );
}

function Banner({
  variant,
  icon,
  title,
  children,
}: {
  variant: 'neutral' | 'info' | 'success' | 'warning' | 'destructive' | 'brand';
  icon: Parameters<typeof Icon>[0]['icon'];
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Alert variant={variant} role="status">
      <Icon icon={icon} />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children ? (
        <AlertDescription className="grid justify-items-start gap-2">{children}</AlertDescription>
      ) : null}
    </Alert>
  );
}

function Banners({
  clarification,
  followUps,
  original,
  now,
  conflict,
}: ClarificationPageProps & { conflict: boolean }) {
  const router = useRouter();
  const { status, dueAt, issuedAt, respondedAt, resolvedAt, commission } = clarification;
  const banners: ReactNode[] = [];
  const open = isOpen(status);
  const pastDue = open && dueAt !== null && countdown(dueAt, now).overdue;

  if (conflict) {
    banners.push(
      <Banner
        key="conflict"
        variant="warning"
        icon={InformationCircleIcon}
        title={COPY.conflictTitle}
      >
        <p>{COPY.conflictBody}</p>
        <Button variant="secondary" size="sm" onClick={() => void router.invalidate()}>
          {COPY.showIt}
        </Button>
      </Banner>,
    );
  }
  if (pastDue) {
    banners.push(
      <Banner key="overdue" variant="destructive" icon={Alert02Icon} title={COPY.overdueTitle}>
        {COPY.overdueBody}
      </Banner>,
    );
  } else if (open && issuedAt && dueAt && reminderSent(issuedAt, null, now)) {
    banners.push(
      <Banner
        key="reminder"
        variant="warning"
        icon={Notification01Icon}
        title={COPY.reminder(countdown(dueAt, now).text, formatDate(dueAt))}
      />,
    );
  } else if (open && !conflict) {
    banners.push(
      <Banner key="once" variant="info" icon={InformationCircleIcon} title={COPY.answerOnce} />,
    );
  }
  if (status === 'responded' && respondedAt && followUps.length === 0) {
    banners.push(
      <Banner
        key="responded"
        variant="info"
        icon={SentIcon}
        title={COPY.submittedTitle(formatDateTime(respondedAt))}
      >
        {clarification.responseLate && dueAt
          ? `${COPY.respondedLate(lateDays(dueAt, respondedAt))} `
          : ''}
        {COPY.willReview(commission.name)}
      </Banner>,
    );
  }
  for (const followUp of followUps) {
    banners.push(
      <Banner
        key={followUp.id}
        variant="warning"
        icon={Message01Icon}
        title={COPY.furtherSent(commission.name)}
      >
        <p>{COPY.furtherOwnPeriod}</p>
        <Button asChild variant="secondary" size="sm">
          <Link to="/clarifications/$id" params={{ id: followUp.id }}>
            {COPY.openFurther(followUp.reference ?? '')}
            <Icon icon={ArrowRight01Icon} />
          </Link>
        </Button>
      </Banner>,
    );
  }
  if (original) {
    banners.push(
      <Banner key="original" variant="neutral" icon={Link01Icon}>
        <p>{original.reference ? COPY.followsUp(original.reference) : COPY.followsUpUnknown}</p>
        <Button asChild variant="link" size="sm">
          <Link to="/clarifications/$id" params={{ id: original.id }}>
            {COPY.seeBefore}
          </Link>
        </Button>
      </Banner>,
    );
  }
  if (status === 'resolved' && resolvedAt) {
    banners.push(
      <Banner
        key="resolved"
        variant="success"
        icon={CheckmarkCircle02Icon}
        title={COPY.resolved(formatDate(resolvedAt))}
      >
        {COPY.resolvedBody(commission.name)}
      </Banner>,
    );
  }
  if (status === 'withdrawn') {
    banners.push(
      <Banner key="withdrawn" variant="neutral" icon={UnavailableIcon} title={COPY.withdrawn}>
        {COPY.withdrawnBody}
      </Banner>,
    );
  }
  return <>{banners}</>;
}

function Points({
  clarification,
  form,
  footer = null,
}: {
  clarification: DeclarantClarification;
  form: ResponseFormState | null;
  footer?: ReactNode;
}) {
  const { items, response } = clarification;
  const heading = form ? COPY.askedOpen : response ? COPY.askedAnswered : COPY.askedClosed;
  return (
    <Card className="p-0 sm:p-0">
      <h2 className="border-b px-5 py-4 text-base font-semibold">{heading}</h2>
      <ol className="divide-y">
        {items.map((item, index) => {
          const answer = response?.items.find((each) => each.index === index);
          const requirement = REQUIREMENTS[item.requirement];
          return (
            <li key={index} className="grid gap-3 px-5 py-5">
              <p className="text-sm font-medium text-muted-foreground">
                {COPY.point(index + 1, items.length)}
              </p>
              <div className="grid gap-1">
                <p className="font-medium">{requirement.ask.en}</p>
                {item.label ? <p className="text-sm">{item.label}</p> : null}
              </div>
              <blockquote className="border-l-2 border-border pl-3 text-sm text-secondary-foreground">
                {item.text}
              </blockquote>
              {answer ? (
                <div className="grid gap-2 rounded-lg bg-muted p-4">
                  <p className="text-sm font-medium">{COPY.yourResponse}</p>
                  <p className="text-sm whitespace-pre-line">{answer.text}</p>
                  {answer.attachments.length > 0 ? (
                    <ul className="grid gap-1.5" aria-label={COPY.documentsFor(index + 1)}>
                      {answer.attachments.map((file) => (
                        <li key={file.uploadId} className="flex items-center gap-2 text-sm">
                          <Icon icon={File02Icon} className="size-4 text-muted-foreground" />
                          {file.fileName}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {form && !answer ? (
                <PointAnswer index={index} placeholder={requirement.placeholder.en} state={form} />
              ) : null}
            </li>
          );
        })}
      </ol>
      {footer}
    </Card>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="grid gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

function PeriodCard({
  clarification,
  now,
}: {
  clarification: DeclarantClarification;
  now: string;
}) {
  const period = periodOf(clarification, now);
  const tone = {
    neutral: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  }[period.tone];
  return (
    <SideCard title={COPY.periodLabel}>
      <div className="grid gap-0.5">
        <p className={`text-lg font-semibold ${tone}`}>{period.title}</p>
        <p className="text-sm text-muted-foreground">{period.detail}</p>
      </div>
      {period.progress ? (
        <ProgressBar
          label={COPY.periodLabel}
          value={period.progress.day}
          max={period.progress.of}
          valueText={`${String(period.progress.day)} of ${String(period.progress.of)} days used`}
          size="sm"
          tone={period.tone === 'danger' ? 'destructive' : 'default'}
          className="[&>div:first-child]:sr-only"
        />
      ) : null}
    </SideCard>
  );
}

function LetterCard({ clarification }: { clarification: DeclarantClarification }) {
  const { letter, letterDownloadUrl } = clarification;
  return (
    <SideCard title={COPY.letter}>
      {letter && letter.status !== 'pending' ? (
        <>
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">{COPY.verificationCode}</p>
            <p className="font-mono text-sm font-semibold break-words">{letter.verificationId}</p>
            {letter.status === 'revoked' ? (
              <Badge variant="destructive">{COPY.revoked}</Badge>
            ) : (
              <Badge variant="success">{COPY.signed}</Badge>
            )}
          </div>
          {letterDownloadUrl ? (
            <Button asChild variant="secondary" size="sm" className="justify-self-start">
              <a href={letterDownloadUrl} download>
                <Icon icon={Download01Icon} />
                {COPY.download}
              </a>
            </Button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{COPY.letterPending}</p>
      )}
    </SideCard>
  );
}

function HistoryCard({
  clarification,
  followUps,
  now,
}: {
  clarification: DeclarantClarification;
  followUps: ClarificationLink[];
  now: string;
}) {
  return (
    <SideCard title={COPY.history}>
      <ol className="grid gap-3">
        {historyOf(clarification, followUps, now).map((entry) => (
          <li key={entry.key} className="grid gap-0.5 border-l-2 border-border pl-3">
            <span className="text-sm font-medium">{entry.title}</span>
            {entry.detail ? (
              <span className="text-sm text-muted-foreground">{entry.detail}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </SideCard>
  );
}
