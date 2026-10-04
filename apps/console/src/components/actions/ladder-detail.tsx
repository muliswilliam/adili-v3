import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  cn,
  daysBetween,
  formatDate,
  formatDateTime,
  Icon,
  LadderStepper,
  type LadderStepperStep,
  useIdempotencyKey,
  useToast,
} from '@adili/ui';
import {
  Attachment01Icon,
  BubbleChatIcon,
  Calendar03Icon,
  Cancel01Icon,
  Download04Icon,
  File01Icon,
  LockIcon,
  RefreshIcon,
  Tick02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import {
  approvedNotIssued,
  canDecideAs,
  isGraveStep,
  LADDER_STEPS,
  ladderSteps,
  type LadderStepView,
  pendingStep,
  subjectOf,
} from '../../actions/ladder';
import { type DecisionLock, decisionRefusal, isLock, REFUSAL_PROBLEM } from '../../actions/refusal';
import type { AdministrativeAction, Ladder } from '../../server/actions.server';
import type { ServiceError, ServiceResult } from '../../server/service-call';
import type { FailureText } from '../dialog-parts';
import { downloadFrom, pendingTab } from '../download';
import { Page } from '../page';
import { closingCauseLabel, en as m, ladderStatusLabel, stepLabel } from './messages';
import { StepBadge } from './status-badge';
import { acknowledgedAt, reinstatedAtOf, salaryStopped } from '../../actions/payroll';
import { PayrollInstruction, payrollInstructionsOf, payrollLine } from './payroll-instruction';
import { stepsBefore } from './prior-steps';
import { ApproveStepDialog, DeclineStepDialog, RestartLadderDialog } from './step-dialogs';
import { stoppageCopy as stoppage } from './stoppage-messages';

/** The decisions on a ladder, as the route makes them for the signed-in officer. */
export interface LadderDecisions {
  approve: (
    actionId: string,
    idempotencyKey: string,
  ) => Promise<ServiceResult<AdministrativeAction>>;
  decline: (
    actionId: string,
    note: string,
    idempotencyKey: string,
  ) => Promise<ServiceResult<AdministrativeAction>>;
  restart: (ladderId: string, idempotencyKey: string) => Promise<ServiceResult<Ladder>>;
  letterLink: (documentId: string) => Promise<ServiceResult<{ downloadUrl: string }>>;
}

export interface LadderDetailProps {
  ladder: Ladder;
  /** The server's clock when the ladder loaded. */
  now: string;
  supervisor: boolean;
  decisions: LadderDecisions;
  /** After a decision: reload the ladder. */
  onChanged: () => void;
}

/** The words for a failed decision, or a refusal to show on the step instead of its buttons. */
function failureOf(
  error: ServiceError,
): { refusal: DecisionLock } | { text: string; problem?: string; reload: boolean } {
  const refusal = decisionRefusal(error);
  if (isLock(refusal)) return { refusal };
  if (refusal === 'not-proposed') {
    return { text: m.failed.notProposed, problem: REFUSAL_PROBLEM[refusal], reload: true };
  }
  if (refusal === 'not-declined') {
    return { text: m.failed.notDeclined, problem: REFUSAL_PROBLEM[refusal], reload: true };
  }
  if (error.kind === 'unauthenticated') return { text: m.failed.signedOut, reload: false };
  if (error.kind === 'unavailable') return { text: m.failed.unavailable, reload: false };
  return { text: m.failed.other, reload: false };
}

/**
 * A ladder (spec 08 FE-5, S5 to S11): who and what it is about, the four steps on a
 * `LadderStepper`, then a card per step taken (drafted, approved, issued, the window, the letter,
 * the declarant's response or the decline note) with Approve and Decline on the step waiting for
 * a decision, and Restart for a supervisor once a step was declined. The review service applies
 * the separation-of-duties rule: when it refuses, the step says why in place of its buttons.
 */
export function LadderDetailView({
  ladder,
  now,
  supervisor,
  decisions,
  onChanged,
}: LadderDetailProps) {
  const subject = subjectOf(ladder);
  const steps = ladderSteps(ladder);
  const reinstatedAt = reinstatedAtOf(ladder.steps);
  const declined =
    ladder.status === 'declined'
      ? (ladder.steps.findLast((action) => action.status === 'declined') ?? null)
      : null;
  return (
    <Page>
      <header className="mb-[22px]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <LadderStatusBadge status={ladder.status} />
          <Badge>
            <Icon icon={ladder.subjectKind === 'obligation' ? Calendar03Icon : BubbleChatIcon} />
            {subject.cause}
          </Badge>
        </div>
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]">
          {ladder.declarantName}
        </h1>
        <p className="mt-1 text-[14.5px] text-muted-foreground">
          {m.fileNumberLine(ladder.personnelFileNumber)}
        </p>
      </header>

      <div className="grid gap-4">
        {declined ? (
          <DeclinedBanner
            ladder={ladder}
            action={declined}
            supervisor={supervisor}
            decisions={decisions}
            onChanged={onChanged}
          />
        ) : null}
        {ladder.status === 'complied' && ladder.endedAt ? (
          <Alert variant="success">
            <Icon icon={Tick02Icon} />
            <AlertTitle>
              {m.compliedTitle(
                formatDate(ladder.endedAt),
                closingCauseLabel(
                  ladder.closingCause ??
                    (ladder.subjectKind === 'obligation' ? 'filed' : 'clarification-resolved'),
                ),
              )}
            </AlertTitle>
            <AlertDescription>
              {m.compliedBody}
              {reinstatedAt ? (
                <span className="block">{stoppage.reinstatementAcknowledged(reinstatedAt)}</span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {ladder.status === 'ended' && ladder.endedAt ? (
          <Alert>
            <Icon icon={Cancel01Icon} />
            <AlertTitle>
              {m.endedTitle(
                formatDate(ladder.endedAt),
                ladder.closingCause
                  ? closingCauseLabel(ladder.closingCause)
                  : m.ended.toLowerCase(),
              )}
            </AlertTitle>
            <AlertDescription>
              {m.endedBody}
              {reinstatedAt ? (
                <span className="block">{stoppage.reinstatementAcknowledged(reinstatedAt)}</span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="px-5 py-5 sm:px-6">
          <LadderStepper label={m.ladderLabel} steps={steps.map((view) => stepperStep(view))} />
        </Card>

        <div className="grid items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            {ladder.steps.map((action) => (
              <StepCard
                key={action.id}
                ladder={ladder}
                action={action}
                now={now}
                supervisor={supervisor}
                decisions={decisions}
                onChanged={onChanged}
              />
            ))}
            <NextStep ladder={ladder} steps={steps} />
          </div>
          <SubjectCard ladder={ladder} />
        </div>
      </div>
    </Page>
  );
}

function LadderStatusBadge({ status }: { status: Ladder['status'] }) {
  const variant =
    status === 'active'
      ? 'info'
      : status === 'complied'
        ? 'success'
        : status === 'declined'
          ? 'destructive'
          : 'default';
  return (
    <Badge variant={variant}>
      {status === 'declined' ? <Icon icon={Cancel01Icon} /> : null}
      {status === 'complied' ? <Icon icon={Tick02Icon} /> : null}
      {ladderStatusLabel(status)}
    </Badge>
  );
}

/** The stepper's line for a step: its date, the window, the response. */
function stepperStep({ step, status, action }: LadderStepView): LadderStepperStep {
  // A step the ladder ended before says only that it was not needed.
  if (status === 'skipped') return { id: step, label: stepLabel(step), status };
  const payroll = action ? payrollLine(action) : undefined;
  const base: LadderStepperStep = {
    id: step,
    label: stepLabel(step),
    status,
    ...(payroll ? { payroll } : {}),
  };
  if (!action) return base;
  // Approved: waiting for payroll, or for its letter to be issued (the payroll line says which).
  if (approvedNotIssued(action) && action.approvedAt) {
    return { ...base, detail: m.stepDetail.approved(formatDate(action.approvedAt)) };
  }
  // A stoppage the disciplinary referral passed: done, its salary still stopped.
  const stoppedAt = acknowledgedAt(action.payrollStop);
  if (status === 'done' && salaryStopped(action) && stoppedAt) {
    // The detail says it all: no payroll line repeating the same date.
    return {
      id: step,
      label: stepLabel(step),
      status,
      detail: stoppage.stepper.salaryStopped(stoppedAt),
    };
  }
  const running = status === 'current' || status === 'stopped';
  const responded = action.response
    ? { response: m.stepDetail.respondedOn(formatDate(action.response.submittedAt)) }
    : {};
  switch (status) {
    case 'awaiting':
      return {
        ...base,
        detail: (
          <>
            <span aria-hidden="true">{`${m.filters.awaiting} · `}</span>
            {m.stepDetail.drafted(formatDate(action.proposedAt))}
          </>
        ),
      };
    case 'declined':
      return action.declinedAt
        ? { ...base, detail: m.stepDetail.declined(formatDate(action.declinedAt)) }
        : base;
    case 'complied':
      return base;
    default:
      return {
        ...base,
        ...(action.issuedAt ? { detail: m.stepDetail.issued(formatDate(action.issuedAt)) } : {}),
        ...(running && action.windowEndsAt
          ? {
              windowEndsAt: action.windowEndsAt,
              ...(step === 'salary-stoppage' ? { windowLabel: m.stoppageWindow } : {}),
            }
          : {}),
        ...responded,
      };
  }
}

function Fact({ term, children, sub }: { term: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[15px] font-medium">
        {children}
        {sub ? <div className="text-[12.5px] font-normal text-muted-foreground">{sub}</div> : null}
      </dd>
    </div>
  );
}

function StepCard({
  ladder,
  action,
  now,
  supervisor,
  decisions,
  onChanged,
}: {
  ladder: Ladder;
  action: AdministrativeAction;
  now: string;
  supervisor: boolean;
  decisions: LadderDecisions;
  onChanged: () => void;
}) {
  const headingId = useId();
  const number = LADDER_STEPS.indexOf(action.step) + 1;
  const waiting = pendingStep(ladder)?.id === action.id;
  const supervisorOnly = !canDecideAs(action.step, false);
  return (
    <Card role="region" aria-labelledby={headingId} className="overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-muted text-[12.5px] font-semibold tabular-nums"
        >
          {number}
        </span>
        <h2 id={headingId} className="text-[16px] font-semibold">
          {stepLabel(action.step)}
        </h2>
        <StepBadge action={action} ladderStatus={ladder.status} />
        <span className="ml-auto">
          {action.reference ? (
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-[12.5px] font-semibold">
              {action.reference}
            </span>
          ) : action.status === 'proposed' ? (
            <span className="rounded-md bg-muted px-2 py-1 text-[12.5px] text-muted-foreground">
              {m.numberOnApproval}
            </span>
          ) : null}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-4 min-[640px]:grid-cols-4">
        <Fact
          term={m.facts.drafted}
          sub={action.proposer ? m.facts.by(action.proposer.name) : undefined}
        >
          {formatDate(action.proposedAt)}
        </Fact>
        {action.status === 'proposed' ? (
          <Fact term={m.facts.approver}>
            {supervisorOnly ? m.approverSupervisor : m.approverReviewStaff}
          </Fact>
        ) : null}
        {action.approvedAt ? (
          <Fact
            term={m.facts.approved}
            sub={action.approver ? m.facts.by(action.approver.name) : undefined}
          >
            {formatDate(action.approvedAt)}
          </Fact>
        ) : null}
        {action.issuedAt ? <Fact term={m.facts.issued}>{formatDate(action.issuedAt)}</Fact> : null}
        {action.windowEndsAt ? (
          <Fact
            term={action.step === 'salary-stoppage' ? stoppage.stoppageWindowEnds : m.facts.actBy}
            sub={
              action.status === 'issued' || action.status === 'responded'
                ? m.inDays(daysBetween(now, action.windowEndsAt))
                : undefined
            }
          >
            {formatDate(action.windowEndsAt)}
          </Fact>
        ) : null}
        {action.declinedAt ? (
          <Fact
            term={m.facts.declined}
            sub={action.declinedBy ? m.facts.by(action.declinedBy.name) : undefined}
          >
            {formatDate(action.declinedAt)}
          </Fact>
        ) : null}
      </dl>

      {action.letter && action.reference ? (
        <div className="px-5 pb-4">
          <LetterRow
            step={action.step}
            reference={action.reference}
            documentId={action.letter.documentId}
            letterLink={decisions.letterLink}
          />
        </div>
      ) : action.status === 'approved' ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">{m.issuingLetter}</p>
      ) : null}

      {payrollInstructionsOf(action).map((instruction) => (
        <div key={instruction.action} className="px-5 pb-4">
          <PayrollInstruction {...instruction} />
        </div>
      ))}

      {action.response ? (
        <div className="px-5 pb-5">
          <Response response={action.response} />
        </div>
      ) : (action.step === 'notice-to-comply' || action.step === 'warning') &&
        action.windowEndsAt !== null &&
        action.windowEndsAt < now &&
        action.status !== 'cancelled' ? (
        <p className="flex items-center gap-2 px-5 pb-4 text-sm text-muted-foreground">
          <span aria-hidden="true">-</span>
          {m.noResponse}
        </p>
      ) : null}

      {action.status === 'declined' && action.declineNote ? (
        <div className="px-5 pb-5">
          <Alert variant="destructive" role="note">
            <Icon icon={Cancel01Icon} />
            <AlertTitle>{m.declinedBy(action.declinedBy?.name ?? '')}</AlertTitle>
            <AlertDescription>{action.declineNote}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {waiting ? (
        <Decision
          ladder={ladder}
          action={action}
          now={now}
          supervisor={supervisor}
          decisions={decisions}
          onChanged={onChanged}
        />
      ) : null}
    </Card>
  );
}

function LockNote({ refusal }: { refusal: DecisionLock }) {
  return (
    <div className="border-t px-5 py-3">
      <Alert
        role="note"
        variant="warning"
        className="px-3 py-2.5 [&>svg]:top-[13px] [&>svg]:left-3 [&>svg]:size-4 [&>svg~*]:pl-[26px]"
      >
        <Icon icon={LockIcon} />
        <AlertTitle>{m.refusals[refusal]}</AlertTitle>
      </Alert>
    </div>
  );
}

/** Approve and Decline on the step waiting for a decision, or why the viewer cannot decide it. */
function Decision({
  ladder,
  action,
  now,
  supervisor,
  decisions,
  onChanged,
}: {
  ladder: Ladder;
  action: AdministrativeAction;
  now: string;
  supervisor: boolean;
  decisions: LadderDecisions;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const approveKey = useIdempotencyKey();
  const declineKey = useIdempotencyKey();
  const [open, setOpen] = useState<'approve' | 'decline' | null>(null);
  const [refusal, setRefusal] = useState<DecisionLock | null>(
    canDecideAs(action.step, supervisor) ? null : 'role',
  );
  if (refusal) return <LockNote refusal={refusal} />;

  const settle = (
    result: ServiceResult<AdministrativeAction>,
    done: (action: AdministrativeAction) => void,
  ): FailureText | null => {
    if (result.ok) {
      setOpen(null);
      done(result.data);
      onChanged();
      return null;
    }
    const failure = failureOf(result.error);
    if ('refusal' in failure) {
      setOpen(null);
      setRefusal(failure.refusal);
      return null;
    }
    if (failure.reload) onChanged();
    return { title: failure.text, ...(failure.problem ? { problem: failure.problem } : {}) };
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-5 py-3">
      <Button
        size="sm"
        onClick={() => {
          setOpen('approve');
        }}
      >
        <Icon icon={Tick02Icon} />
        {m.approve}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setOpen('decline');
        }}
      >
        <Icon icon={Cancel01Icon} />
        {m.decline}
      </Button>
      <ApproveStepDialog
        open={open === 'approve'}
        onOpenChange={(next) => {
          setOpen(next ? 'approve' : null);
        }}
        step={action.step}
        declarantName={ladder.declarantName}
        subjectTitle={subjectOf(ladder).title}
        personnelFileNumber={ladder.personnelFileNumber}
        now={now}
        {...(isGraveStep(action.step)
          ? { earlier: { state: 'ok' as const, steps: stepsBefore(ladder, action.id) } }
          : {})}
        onSubmit={async () =>
          settle(await decisions.approve(action.id, approveKey.keyFor(action.id)), (approved) => {
            toast({
              title: m.approved(approved.step, approved.reference),
              description: stoppage.approvedDetail[approved.step] ?? m.approvedDetail,
            });
          })
        }
      />
      <DeclineStepDialog
        open={open === 'decline'}
        onOpenChange={(next) => {
          setOpen(next ? 'decline' : null);
        }}
        step={action.step}
        declarantName={ladder.declarantName}
        onSubmit={async (note) =>
          settle(
            await decisions.decline(action.id, note, declineKey.keyFor({ id: action.id, note })),
            (declined) => {
              toast({
                title: m.declined(declined.step),
                description: m.declinedDetail(declined.step),
              });
            },
          )
        }
      />
    </div>
  );
}

function LetterRow({
  step,
  reference,
  documentId,
  letterLink,
}: {
  step: AdministrativeAction['step'];
  reference: string;
  documentId: string;
  letterLink: LadderDecisions['letterLink'];
}) {
  const { toast } = useToast();
  const failed = () => {
    toast({ title: m.letterUnavailable, urgency: 'assertive' });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5">
      <span className="flex size-8 items-center justify-center rounded-md bg-muted">
        <Icon icon={File01Icon} className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-[180px]">
        <div className="text-[14.5px] font-medium">{m.letterTitle(step)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="info" className="text-[10.5px] tracking-wide uppercase">
            {m.restricted}
          </Badge>
          <span className="font-mono text-[12px] whitespace-nowrap text-muted-foreground">
            {reference}
          </span>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const tab = pendingTab();
            void letterLink(documentId).then((result) => {
              if (result.ok) {
                tab.show(result.data.downloadUrl);
              } else {
                tab.close();
                failed();
              }
            });
          }}
        >
          <Icon icon={ViewIcon} />
          {m.viewLetter}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void letterLink(documentId).then((result) => {
              if (result.ok) downloadFrom(result.data.downloadUrl);
              else failed();
            });
          }}
        >
          <Icon icon={Download04Icon} />
          {m.downloadLetter}
        </Button>
      </div>
    </div>
  );
}

function Response({ response }: { response: NonNullable<AdministrativeAction['response']> }) {
  return (
    <div className="grid gap-3 rounded-lg bg-muted p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Icon icon={BubbleChatIcon} className="size-4" />
        <span className="font-semibold">{m.response}</span>
        <span className="text-muted-foreground">{formatDateTime(response.submittedAt)}</span>
      </div>
      <p className="text-[14.5px] leading-relaxed whitespace-pre-line">{response.text}</p>
      {response.attachments.length > 0 ? (
        <ul className="grid gap-2">
          {response.attachments.map((file) => (
            <li
              key={file.uploadId}
              className="flex items-center gap-3 rounded-lg border bg-card px-3.5 py-2.5"
            >
              <span className="flex size-8 items-center justify-center rounded-md bg-muted">
                <Icon icon={Attachment01Icon} className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-medium">{file.fileName}</div>
                <div className="text-[12.5px] text-muted-foreground">{m.attachmentHint}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[13px] text-muted-foreground">{m.responseNote}</p>
    </div>
  );
}

/** The step that follows a running one, drafted when its window ends unless the declarant complies. */
function NextStep({ ladder, steps }: { ladder: Ladder; steps: LadderStepView[] }) {
  if (ladder.status !== 'active') return null;
  const index = steps.findIndex((view) => view.status === 'current' || view.status === 'stopped');
  const running = steps[index];
  const next = steps[index + 1];
  if (!running?.action?.windowEndsAt || !next || next.action) return null;
  return (
    <div className="flex items-center gap-3 rounded-card border border-dashed px-5 py-4">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full bg-muted text-[12.5px] font-semibold text-muted-foreground"
      >
        {index + 2}
      </span>
      <div>
        <div className="font-medium">{stepLabel(next.step)}</div>
        <div className="text-sm text-muted-foreground">
          {m.nextStepDetail(formatDate(running.action.windowEndsAt))}
        </div>
      </div>
    </div>
  );
}

function SubjectCard({ ladder }: { ladder: Ladder }) {
  const subject = subjectOf(ladder);
  return (
    <Card className="p-0 sm:p-0">
      <dl className="grid gap-4 px-5 py-5">
        <Fact
          term={
            ladder.subjectKind === 'obligation' ? m.subject.obligation : m.subject.clarification
          }
        >
          <span className={cn(subject.reference && 'font-mono text-[14px]')}>{subject.title}</span>
        </Fact>
        <Fact term={m.subject.started}>{formatDate(ladder.startedAt)}</Fact>
        {ladder.endedAt ? <Fact term={m.subject.ended}>{formatDate(ladder.endedAt)}</Fact> : null}
      </dl>
    </Card>
  );
}

function DeclinedBanner({
  ladder,
  action,
  supervisor,
  decisions,
  onChanged,
}: {
  ladder: Ladder;
  action: AdministrativeAction;
  supervisor: boolean;
  decisions: LadderDecisions;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const key = useIdempotencyKey();
  const [open, setOpen] = useState(false);
  return (
    <Alert variant="destructive">
      <Icon icon={Cancel01Icon} />
      <AlertTitle>
        {m.declinedTitle(
          action.step,
          action.declinedBy?.name ?? '',
          action.declinedAt ? formatDate(action.declinedAt) : '',
        )}
      </AlertTitle>
      <AlertDescription className="grid justify-items-start gap-3">
        <p>{m.declinedBody}</p>
        {supervisor ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                setOpen(true);
              }}
            >
              <Icon icon={RefreshIcon} />
              {m.restart}
            </Button>
            <RestartLadderDialog
              open={open}
              onOpenChange={setOpen}
              step={action.step}
              onSubmit={async () => {
                const result = await decisions.restart(ladder.id, key.keyFor(ladder.id));
                if (result.ok) {
                  setOpen(false);
                  toast({ title: m.restarted, description: m.restartedDetail(action.step) });
                  onChanged();
                  return null;
                }
                const failure = failureOf(result.error);
                if ('refusal' in failure) {
                  return { title: m.restartRefused, problem: REFUSAL_PROBLEM[failure.refusal] };
                }
                if (failure.reload) onChanged();
                return {
                  title: failure.text,
                  ...(failure.problem ? { problem: failure.problem } : {}),
                };
              }}
            />
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
