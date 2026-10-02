import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardTitle,
  cn,
  formatDate,
  formatDateTime,
  Icon,
  type IconProps,
  ProgressBar,
  ReferenceChip,
  RegisterTimeline,
  SCOPE_SECTIONS,
  scopeSectionLabels,
  Tooltip,
  useToast,
} from '@adili/ui';
import {
  ArrowLeft01Icon,
  BalanceScaleIcon,
  Calendar03Icon,
  Cancel01Icon,
  Clock01Icon,
  InformationCircleIcon,
  Notification01Icon,
  PoliceBadgeIcon,
  Stamp01Icon,
  Tick02Icon,
  UnavailableIcon,
  Undo02Icon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, type RefObject, useRef, useState } from 'react';

import { NOTICE_COPY as COPY, OUTCOMES, RESPONSE_COPY } from '../../access/notice-copy';
import { badgeState, historyOf, leaTitle, windowOpen, windowView } from '../../access/notices';
import { accessReferenceParts } from '../../access/reference';
import { checkRepresentations } from '../../access/representation-form';
import { submitMyRepresentations } from '../../server/access-notices';
import type {
  DeclarantNotice,
  FormKDeclarantNotice,
  LeaDeclarantNotice,
  Scope,
} from '../../server/access/types';
import { loginHref } from '../sign-in';
import { GroundsList } from '../access/request-parts';
import { NoticeStateBadge } from './notice-parts';
import {
  ConsentDialog,
  RepresentationFormCard,
  savedToast,
  type SendError,
  SentResponseCard,
  useRepresentationForm,
} from './representation-form';

/**
 * A request someone made to see the declarant's declaration (spec 10 FE-4, S4): what was asked,
 * by whom and why in general terms, the window for their response with the form (object,
 * consent or add context, with documents) and their response once sent, editable until the
 * window closes; after the decision, the outcome with its grounds and reasons. A law-enforcement
 * grant shows once access was granted, without a form, and only its agency, case reference,
 * outcome and dates: never the agency's reason, the scope or the grounds (spec 10 decision 4).
 */
export function NoticePage({ notice, now }: { notice: DeclarantNotice; now: string }) {
  return notice.kind === 'lea' ? (
    <LeaNoticePage notice={notice} now={now} />
  ) : (
    <FormKNoticePage notice={notice} now={now} />
  );
}

function LeaNoticePage({ notice, now }: { notice: LeaDeclarantNotice; now: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <main className="mx-auto grid w-full max-w-[1000px] flex-1 content-start gap-6 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
      <Header notice={notice} now={now} headingRef={headingRef} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-5">
          <LeaBanner notice={notice} />
          <LeaRequestCard notice={notice} />
        </div>
        <aside className="grid gap-5">
          <Card className="gap-4">
            <CardTitle>{COPY.history}</CardTitle>
            <RegisterTimeline entries={historyOf(notice)} label={COPY.history} />
          </Card>
        </aside>
      </div>
    </main>
  );
}

function FormKNoticePage(props: { notice: FormKDeclarantNotice; now: string }) {
  // A saved response replaces the loaded notice without a reload.
  const [notice, setNotice] = useState(props.notice);
  const [editing, setEditing] = useState(false);
  // The window closed while the declarant was writing (409): the form stays, disabled.
  const [conflict, setConflict] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { now } = props;
  const open = windowOpen(notice, now) && !conflict;
  const showForm = (open && (!notice.representations || editing)) || conflict;

  return (
    <main className="mx-auto grid w-full max-w-[1000px] flex-1 content-start gap-6 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
      <Header notice={notice} now={now} headingRef={headingRef} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-5">
          <Banner notice={notice} now={now} conflict={conflict} />
          {/* On a phone the countdown comes before the request, not after the form. */}
          <WindowCard notice={notice} now={now} className="lg:hidden" />
          <DecisionCard notice={notice} />
          <RequestCard notice={notice} />
          {showForm ? (
            <ResponseForm
              // A fresh form each time an edit starts.
              key={`${notice.representations?.updatedAt ?? 'new'}:${String(editing)}`}
              notice={notice}
              editing={editing}
              conflict={conflict}
              onSaved={(saved) => {
                setNotice(saved);
                setEditing(false);
                // The form is gone: take focus (and the view) back to the top of the page.
                requestAnimationFrame(() => headingRef.current?.focus());
              }}
              onConflict={() => {
                setConflict(true);
                // The service says the window is closed: read the request as under decision.
                setNotice((current) => ({
                  ...current,
                  canRespond: false,
                  status:
                    current.status === 'awaiting-representations'
                      ? 'under-decision'
                      : current.status,
                }));
              }}
              onCancel={() => {
                setEditing(false);
              }}
            />
          ) : notice.representations ? (
            <SentResponseCard
              representations={notice.representations}
              canEdit={open}
              onEdit={() => {
                setEditing(true);
              }}
            />
          ) : null}
        </div>
        <aside className="grid gap-5">
          <WindowCard notice={notice} now={now} className="hidden lg:flex" />
          <Card className="gap-4">
            <CardTitle>{COPY.history}</CardTitle>
            <RegisterTimeline entries={historyOf(notice)} label={COPY.history} />
          </Card>
        </aside>
      </div>
    </main>
  );
}

function Header({
  notice,
  now,
  headingRef,
}: {
  notice: DeclarantNotice;
  now: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const lea = notice.kind === 'lea';
  return (
    <div className="grid gap-3">
      <Button asChild variant="ghost" size="sm" className="justify-self-start">
        <Link to="/access/notices" search={{}}>
          <Icon icon={ArrowLeft01Icon} />
          {COPY.back}
        </Link>
      </Button>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-[26px] leading-tight font-semibold tracking-[-0.02em] outline-none sm:text-[28px]"
      >
        {lea ? COPY.leaTitle : COPY.pageTitle}
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {lea ? (
          <span className="font-mono text-[13.5px]">{notice.reference}</span>
        ) : (
          <ReferenceChip
            reference={notice.reference}
            parts={accessReferenceParts(notice.commission.name)}
            size="sm"
          />
        )}
        <NoticeStateBadge state={badgeState(notice, now)} />
        <span className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground [&_svg]:size-4">
          <Icon icon={Calendar03Icon} />
          {notice.kind === 'lea'
            ? COPY.granted(formatDate(notice.decidedAt))
            : notice.noticeChannel === 'written'
              ? COPY.notifiedInWriting(formatDate(notice.notifiedAt))
              : COPY.notified(formatDate(notice.notifiedAt))}
        </span>
      </div>
    </div>
  );
}

type AlertVariant = 'neutral' | 'info' | 'success' | 'warning' | 'destructive' | 'brand';

function BannerBox({
  variant,
  icon,
  lead,
  children,
}: {
  variant: AlertVariant;
  icon: IconProps['icon'];
  lead: string;
  children?: ReactNode;
}) {
  return (
    <Alert variant={variant} role="status">
      <Icon icon={icon} />
      <AlertDescription>
        <strong className="font-semibold">{lead}</strong> {children}
      </AlertDescription>
    </Alert>
  );
}

const DECIDED_BANNERS = {
  grant: { variant: 'info', icon: Stamp01Icon },
  'partial-grant': { variant: 'warning', icon: Stamp01Icon },
  deny: { variant: 'success', icon: UnavailableIcon },
} as const;

/** The grant, and why the declarant hears of it only now. */
function LeaBanner({ notice }: { notice: LeaDeclarantNotice }) {
  return (
    <BannerBox variant="info" icon={PoliceBadgeIcon} lead={`${leaTitle(notice)}.`}>
      <Tooltip content={COPY.leaWhyNow}>
        <button
          type="button"
          className="inline-flex items-center gap-1 align-bottom font-medium underline decoration-current/40 underline-offset-3 hover:decoration-current [&_svg]:size-3.5"
        >
          <Icon icon={InformationCircleIcon} />
          {COPY.whyNow}
        </button>
      </Tooltip>
    </BannerBox>
  );
}

/** What happened and what happens next, for every state the declarant can see. */
function Banner({
  notice,
  now,
  conflict,
}: {
  notice: FormKDeclarantNotice;
  now: string;
  conflict: boolean;
}) {
  const commission = notice.commission.name;
  const windowEnd = notice.windowEndsAt ? formatDateTime(notice.windowEndsAt) : '';
  if (conflict) {
    return (
      <BannerBox variant="warning" icon={Clock01Icon} lead={COPY.bannerConflict}>
        {COPY.bannerConflictNext(commission)}
      </BannerBox>
    );
  }
  if (notice.status === 'withdrawn' || notice.status === 'cannot-identify') {
    return (
      <BannerBox variant="neutral" icon={Undo02Icon} lead={COPY.bannerWithdrawn}>
        {COPY.bannerWithdrawnNext}
      </BannerBox>
    );
  }
  const { decision } = notice;
  if (decision) {
    const { outcome } = decision;
    const meta = DECIDED_BANNERS[outcome];
    return (
      <BannerBox
        variant={meta.variant}
        icon={meta.icon}
        lead={COPY.bannerDecided(
          commission,
          OUTCOMES[outcome].verb.en,
          formatDate(decision.decidedAt),
        )}
      >
        {OUTCOMES[outcome].released.en}
      </BannerBox>
    );
  }
  if (windowOpen(notice, now)) {
    return notice.representations ? (
      <BannerBox variant="info" icon={Tick02Icon} lead={COPY.bannerSaved}>
        {COPY.bannerSavedNext(windowEnd)}
      </BannerBox>
    ) : (
      <BannerBox variant="warning" icon={Notification01Icon} lead={COPY.bannerNotice}>
        {COPY.bannerNoticeNext(windowEnd, commission)}
      </BannerBox>
    );
  }
  if (notice.representations?.stance === 'consent') {
    return (
      <BannerBox variant="info" icon={Tick02Icon} lead={COPY.bannerConsented}>
        {COPY.bannerConsentedNext(commission)}
      </BannerBox>
    );
  }
  return (
    <BannerBox
      variant="neutral"
      icon={BalanceScaleIcon}
      lead={COPY.bannerClosed(notice.windowEndsAt ? formatDate(notice.windowEndsAt) : '')}
    >
      {notice.representations
        ? COPY.bannerClosedWithResponse(commission)
        : COPY.bannerClosedNoResponse(commission)}
    </BannerBox>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-[168px_minmax(0,1fr)]">{children}</dl>;
}

function Row({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:col-span-2 sm:grid-cols-subgrid sm:gap-0">
      <dt className="text-[13.5px] text-muted-foreground sm:pt-px">{term}</dt>
      <dd className="text-[14.5px] break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

function DecisionCard({ notice }: { notice: FormKDeclarantNotice }) {
  const { decision } = notice;
  if (!decision) return null;
  return (
    <Card className="gap-4">
      <div className="flex items-baseline gap-3">
        <CardTitle className="flex-1">{COPY.decision}</CardTitle>
        <span className="text-sm text-muted-foreground">{formatDate(decision.decidedAt)}</span>
      </div>
      <Rows>
        {decision.grounds.length > 0 ? (
          <Row term={COPY.grounds}>
            <GroundsList grounds={decision.grounds} />
          </Row>
        ) : null}
        <Row term={COPY.reasons}>{decision.reasons}</Row>
      </Rows>
    </Card>
  );
}

type ChipState = 'in' | 'withheld' | 'not-asked';

function ScopeChip({ label, state }: { label: string; state: ChipState }) {
  return (
    <li
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[13px] font-medium [&_svg]:size-3',
        state === 'in' && 'bg-muted text-secondary-foreground',
        state === 'withheld' && 'bg-destructive-subtle text-destructive line-through',
        state === 'not-asked' && 'text-muted-foreground inset-ring inset-ring-border',
      )}
    >
      <Icon icon={state === 'in' ? Tick02Icon : Cancel01Icon} strokeWidth={2.6} />
      {label}
      {state === 'in' ? null : (
        <span className="sr-only">
          {' '}
          ({state === 'withheld' ? COPY.notReleased : COPY.notAsked})
        </span>
      )}
    </li>
  );
}

/**
 * A scope as rows of chips. With `granted` (a partial grant), what was asked but not released is
 * struck through as withheld.
 */
function ScopeView({ scope, granted }: { scope: Scope; granted: Scope | null }) {
  const asked = (on: boolean, kept: boolean | undefined): ChipState =>
    !on ? 'not-asked' : granted && !kept ? 'withheld' : 'in';
  const sections = SCOPE_SECTIONS.filter((section) => scope.sections.includes(section));
  return (
    <div className="grid gap-3">
      <Rows>
        <Row term={COPY.years}>
          <ul className="flex flex-wrap gap-1.5">
            {[...scope.years]
              .sort((a, b) => a - b)
              .map((year) => (
                <ScopeChip
                  key={year}
                  label={String(year)}
                  state={asked(true, granted?.years.includes(year))}
                />
              ))}
          </ul>
        </Row>
        <Row term={COPY.people}>
          <ul className="flex flex-wrap gap-1.5">
            <ScopeChip label={COPY.you} state="in" />
            <ScopeChip
              label={COPY.spouse}
              state={asked(scope.includeSpouses, granted?.includeSpouses)}
            />
            <ScopeChip
              label={COPY.children}
              state={asked(scope.includeChildren, granted?.includeChildren)}
            />
          </ul>
        </Row>
        <Row term={COPY.sections}>
          <ul className="flex flex-wrap gap-1.5">
            {sections.map((section) => (
              <ScopeChip
                key={section}
                label={scopeSectionLabels[section]}
                state={asked(true, granted?.sections.includes(section))}
              />
            ))}
          </ul>
        </Row>
      </Rows>
      {granted ? (
        <div
          className="flex items-center gap-2 text-[13px] text-muted-foreground"
          aria-hidden="true"
        >
          <ul className="contents">
            <ScopeChip label={COPY.withheld} state="withheld" />
          </ul>
          {COPY.notReleased}
        </div>
      ) : null}
    </div>
  );
}

function RequestCard({ notice }: { notice: FormKDeclarantNotice }) {
  const partial =
    notice.decision?.outcome === 'partial-grant' ? notice.decision.grantedScope : null;
  return (
    <Card className="gap-0 p-0 sm:p-0">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <CardTitle>{COPY.request}</CardTitle>
      </div>
      <div className="grid gap-5 px-5 py-5 sm:px-6">
        <Rows>
          <Row term={COPY.applicant}>{notice.applicantName}</Row>
          <Row term={COPY.commission}>{notice.commission.name}</Row>
          <Row term={COPY.purpose}>{notice.purposeInGeneralTerms}</Row>
        </Rows>
        <div className="grid gap-2.5 border-t border-border pt-5">
          <p className="text-[13.5px] font-medium">
            {partial ? COPY.scopeAskedAndGranted : COPY.scopeAsked}
          </p>
          <ScopeView scope={notice.scope} granted={partial} />
        </div>
      </div>
    </Card>
  );
}

/** A law-enforcement grant: the agency, its case reference, the outcome and its dates only. */
function LeaRequestCard({ notice }: { notice: LeaDeclarantNotice }) {
  return (
    <Card className="gap-0 p-0 sm:p-0">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <CardTitle>{COPY.request}</CardTitle>
      </div>
      <div className="px-5 py-5 sm:px-6">
        <Rows>
          <Row term={COPY.agency}>{notice.agency.name}</Row>
          <Row term={COPY.caseReference}>
            <span className="font-mono">{notice.caseReference}</span>
          </Row>
          <Row term={COPY.commission}>{notice.commission.name}</Row>
          <Row term={COPY.outcome}>{OUTCOMES[notice.outcome].label.en}</Row>
          <Row term={COPY.grantedOn}>{formatDate(notice.decidedAt)}</Row>
          <Row term={COPY.notifiedOn}>{formatDate(notice.notifiedAt)}</Row>
        </Rows>
      </div>
    </Card>
  );
}

/** The window's countdown while open; how it closed once closed. */
function WindowCard({
  notice,
  now,
  className,
}: {
  notice: FormKDeclarantNotice;
  now: string;
  className?: string;
}) {
  const view = windowView(notice, now);
  if (!view || !notice.windowEndsAt) return null;
  const tone = {
    neutral: null,
    warning: 'text-warning',
    danger: 'text-destructive',
  }[view.tone];
  return (
    <Card className={cn('gap-3', className)} role="group" aria-label={COPY.window}>
      <p className={cn('text-[20px] leading-tight font-semibold tracking-[-0.01em]', tone)}>
        {view.title}
      </p>
      <p className="-mt-2 text-[13.5px] text-muted-foreground">{view.detail}</p>
      <ProgressBar
        label={COPY.window}
        value={view.day}
        max={view.of}
        size="sm"
        showValue={false}
        tone={view.tone === 'danger' ? 'destructive' : 'default'}
        valueText={COPY.daysUsed(view.day, view.of)}
      />
      <p
        aria-hidden="true"
        className="-mt-1 flex justify-between text-[12.5px] text-muted-foreground"
      >
        <span>{formatDate(notice.notifiedAt)}</span>
        <span>{formatDate(notice.windowEndsAt)}</span>
      </p>
    </Card>
  );
}

/** The form while the window is open, and sending it (with a confirmation before consent). */
function ResponseForm({
  notice,
  editing,
  conflict,
  onSaved,
  onConflict,
  onCancel,
}: {
  notice: FormKDeclarantNotice;
  editing: boolean;
  conflict: boolean;
  onSaved: (notice: FormKDeclarantNotice) => void;
  onConflict: () => void;
  onCancel: () => void;
}) {
  const state = useRepresentationForm(editing ? notice.representations : null);
  const { toast, dismiss } = useToast();
  const router = useRouter();
  // The form's warnings still showing: cleared when it is sent again, or saved.
  const [warnings] = useState(() => new Set<number>());
  function warn(title: string) {
    warnings.add(toast({ title, urgency: 'assertive' }));
  }
  function clearWarnings() {
    for (const id of warnings) dismiss(id);
    warnings.clear();
  }
  // One key per body: a retry of the same response replays, a changed one is a new request.
  const [attempt, setAttempt] = useState<{ key: string; body: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError>(null);
  const signInHref = loginHref(`/access/notices/${notice.requestId}`);

  function submit() {
    state.dispatch({ type: 'tried' });
    setError(null);
    clearWarnings();
    const check = checkRepresentations(state.form);
    switch (check.status) {
      case 'stance-missing':
        warn(RESPONSE_COPY.stanceMissing);
        return;
      case 'text':
        warn(RESPONSE_COPY.checkBeforeSend);
        return;
      case 'files-checking':
        toast({ title: RESPONSE_COPY.filesStillChecking });
        return;
      case 'files-not-accepted':
        warn(RESPONSE_COPY.filesNotAccepted);
        return;
      case 'ready':
        if (check.body.stance === 'consent') setConfirming(true);
        else void send();
    }
  }

  async function send() {
    const check = checkRepresentations(state.form);
    if (check.status !== 'ready') return;
    const body = JSON.stringify(check.body);
    const idempotencyKey = attempt?.body === body ? attempt.key : crypto.randomUUID();
    setAttempt({ key: idempotencyKey, body });
    setSending(true);
    let result;
    try {
      result = await submitMyRepresentations({
        data: { requestId: notice.requestId, idempotencyKey, ...check.body },
      });
    } catch {
      result = { status: 'unavailable' } as const;
    }
    setSending(false);
    setConfirming(false);
    switch (result.status) {
      case 'saved':
        clearWarnings();
        toast({ title: savedToast(result.notice, notice.representations === null) });
        onSaved(result.notice);
        return;
      case 'closed':
        onConflict();
        return;
      case 'invalid':
        warn(result.attachment ? RESPONSE_COPY.attachmentRefused : RESPONSE_COPY.checkBeforeSend);
        return;
      case 'not-found':
        void router.invalidate();
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
      <RepresentationFormCard
        notice={notice}
        state={state}
        editing={editing}
        disabled={conflict}
        busy={sending && !confirming}
        error={error}
        signInHref={signInHref}
        onSubmit={submit}
        onCancel={onCancel}
      />
      <ConsentDialog
        open={confirming}
        busy={sending}
        notice={notice}
        onOpenChange={setConfirming}
        onConfirm={() => void send()}
      />
    </>
  );
}
