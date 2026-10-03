import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogFooter,
  EmptyState,
  formatDate,
  formatDateTime,
  Icon,
  type IconProps,
  OutcomeBadge,
  OUTCOME_BADGE_MESSAGES,
  PriorityBadge,
  ReferenceChip,
  SeverityBadge,
  Spinner,
  useToast,
} from '@adili/ui';
import {
  ArrowRight02Icon,
  ArrowTurnBackwardIcon,
  Building03Icon,
  Calendar03Icon,
  Clock01Icon,
  File01Icon,
  JusticeScale01Icon,
  LinkSquare02Icon,
  PencilEdit02Icon,
  SquareLock02Icon,
  StampIcon,
  Tick02Icon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';

import { CLARIFICATION_STATUSES } from '../../clarification/labels';
import {
  determinationHistory,
  type DeterminationState,
  determinationState,
  type HistoryEntry,
} from '../../determination/view';
import { reportingEntityOf } from '../../review-case/declaration';
import { DECLARATION_TYPES } from '../../review-case/labels';
import {
  getDecisionLetterLink,
  proposeCaseDetermination,
  withdrawCaseDetermination,
} from '../../server/determinations';
import type { DeterminationRefusal } from '../../server/determinations.server';
import type { CaseView } from '../../server/review-case.server';
import type { Determination, DeterminationInput } from '../../server/review/types';
import { downloadFrom } from '../download';
import { InfoTip } from '../info-tip';
import { Page } from '../page';
import { CaseStatusBadge } from '../review/case/case-header';
import { TONES } from '../review/status-badge';
import type { FailureText } from './dialog-parts';
import { messages as t } from './messages';
import { ProposeDialog } from './propose-dialog';

/**
 * A case's Determination page (spec 08 FE-2; S1, S2): the case header, a banner saying where the
 * determination stands and what the viewer may do (propose, withdraw, revise, open in Approvals,
 * download the letter), the determination with its history, and beside it what a determination
 * rests on: the reviewers of record (none of whom may approve it), the flags and the
 * clarifications.
 */
export interface DeterminationPageProps {
  load: CaseView;
  supervisor: boolean;
  /** A fresh Idempotency-Key per proposal; tests fix it. */
  newKey?: () => string;
}

const STATUS_VARIANT = {
  proposed: 'warning',
  approved: 'success',
  returned: 'destructive',
  withdrawn: 'default',
} as const;

const HISTORY_ICON: Record<HistoryEntry['kind'], IconProps['icon']> = {
  proposed: JusticeScale01Icon,
  returned: ArrowTurnBackwardIcon,
  approved: StampIcon,
  withdrawn: ArrowTurnBackwardIcon,
};

/** The refusal's words in the propose dialog, with the problem it answered. */
function proposeFailure(
  result: Awaited<ReturnType<typeof proposeCaseDetermination>>,
): FailureText | null {
  if (result.ok) return null;
  if (result.refusal) return refusalText(result.refusal);
  if (result.error.kind === 'unauthenticated') return { title: t.toasts.sessionEnded };
  return { title: t.toasts.failed };
}

function refusalText(refusal: DeterminationRefusal): FailureText {
  const status = refusal.kind.startsWith('not-the') ? 403 : 409;
  const words =
    refusal.kind in t.refusals
      ? t.refusals[refusal.kind as keyof typeof t.refusals]
      : { title: t.toasts.failed };
  return { ...words, problem: `${String(status)} ${refusal.kind}` };
}

export function DeterminationPage({
  load,
  supervisor,
  newKey = () => crypto.randomUUID(),
}: DeterminationPageProps) {
  const { detail, viewer } = load;
  const item = detail.case;
  const router = useRouter();
  const { toast } = useToast();
  const state = determinationState(item, detail.determinations, {
    subject: viewer.subject,
    supervisor,
  });
  const [proposing, setProposing] = useState<{ revise: boolean; key: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState<'withdraw' | 'letter' | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  async function propose(input: DeterminationInput): Promise<FailureText | null> {
    idempotencyKey.current ??= newKey();
    const result = await proposeCaseDetermination({
      data: {
        caseId: item.id,
        input: { ...input, furtherActionNote: input.furtherActionNote ?? null },
        idempotencyKey: idempotencyKey.current,
      },
    });
    const failure = proposeFailure(result);
    // A refusal is an answer: the next try is a new request. A failure may not have been.
    if (result.ok || result.refusal) idempotencyKey.current = null;
    if (failure) return failure;
    setProposing(null);
    toast({ title: t.toasts.proposed });
    await router.invalidate();
    return null;
  }

  async function withdraw(determination: Determination) {
    setBusy('withdraw');
    const result = await withdrawCaseDetermination({
      data: { determinationId: determination.id },
    });
    setBusy(null);
    setWithdrawing(false);
    if (result.ok) toast({ title: t.toasts.withdrawn });
    else if (result.refusal)
      toast({ title: refusalText(result.refusal).title, urgency: 'assertive' });
    else toast({ title: t.toasts.failed, urgency: 'assertive' });
    await router.invalidate();
  }

  async function letter(determination: Determination) {
    setBusy('letter');
    const result = await getDecisionLetterLink({
      data: { determinationId: determination.id },
    }).catch(() => ({ ok: false }) as const);
    setBusy(null);
    if (result.ok) downloadFrom(result.data.downloadUrl);
    else toast({ title: t.toasts.letterFailed, urgency: 'assertive' });
  }

  const reportingEntity = reportingEntityOf(detail.document);
  const current = state.kind === 'none' ? null : state.current;
  const revising =
    proposing?.revise && state.kind === 'returned'
      ? {
          form: {
            outcome:
              state.current.outcome === 'compliant-no-issues' ? 'compliant' : state.current.outcome,
            reasons: state.current.reasons,
            note: state.current.furtherActionNote ?? '',
          },
          returnedBy: state.current.returnedBy?.name ?? 'The supervisor',
          reason: state.current.returnReason ?? '',
        }
      : null;

  return (
    <Page>
      <Card className="mb-4 grid gap-3.5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <ReferenceChip reference={item.reference} size="sm" />
          <Badge>{`${DECLARATION_TYPES[item.type]} ${String(item.cycleYear)}`}</Badge>
          <PriorityBadge band={item.band} />
          <CaseStatusBadge status={item.status} />
        </div>
        <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em]">
          {item.declarantName}
        </h1>
        <p className="flex flex-wrap gap-x-[18px] gap-y-1 text-sm text-muted-foreground">
          <Meta icon={File01Icon}>{item.personnelFileNumber}</Meta>
          {reportingEntity ? <Meta icon={Building03Icon}>{reportingEntity}</Meta> : null}
          <Meta icon={Calendar03Icon}>{`Received ${formatDate(item.receivedAt)}`}</Meta>
          <Meta icon={UserIcon}>{item.assignee?.name ?? 'Unassigned'}</Meta>
        </p>
        <div className="flex flex-wrap gap-2">
          {state.kind === 'none' && state.propose === 'allowed' ? (
            <Button
              onClick={() => {
                setProposing({ revise: false, key: newKey() });
              }}
            >
              <Icon icon={JusticeScale01Icon} />
              {t.propose}
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link to="/review/cases/$caseId" params={{ caseId: item.id }}>
              <Icon icon={LinkSquare02Icon} />
              {t.fullCase}
            </Link>
          </Button>
        </div>
      </Card>

      <Banner
        state={state}
        busy={busy}
        onWithdraw={() => {
          setWithdrawing(true);
        }}
        onRevise={() => {
          setProposing({ revise: true, key: newKey() });
        }}
        onLetter={(determination) => void letter(determination)}
      />

      <div className="grid items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_380px]">
        <DeterminationCard state={state} determinations={detail.determinations} />
        <div className="grid gap-4">
          <SideCard
            title={
              <span className="inline-flex items-center gap-1.5">
                {t.side.reviewers}
                <InfoTip label={t.side.reviewers} content={t.side.reviewersTip} />
              </span>
            }
          >
            <p className="px-5 py-4 text-[14.5px] font-medium">
              {detail.reviewerHistory.length > 0 ? (
                detail.reviewerHistory.map((each) => each.name).join(', ')
              ) : (
                <span className="font-normal text-muted-foreground">{t.side.noReviewers}</span>
              )}
            </p>
          </SideCard>
          <FlagsCard flags={detail.flags} />
          <SideCard title={t.side.clarifications}>
            {detail.clarifications.filter((each) => each.reference).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">{t.side.noClarifications}</p>
            ) : (
              <ul className="divide-y px-5">
                {detail.clarifications
                  .filter((each) => each.reference)
                  .map((each) => {
                    const { label, tone } = CLARIFICATION_STATUSES[each.status];
                    return (
                      <li key={each.id} className="flex items-center gap-3 py-3">
                        <Link
                          to="/review/cases/$caseId/clarifications/$clarificationId"
                          params={{ caseId: item.id, clarificationId: each.id }}
                          className="font-mono text-[13px] font-medium hover:underline"
                        >
                          {each.reference}
                        </Link>
                        <span className="ml-auto">
                          <Badge variant={TONES[tone].badge}>{label}</Badge>
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}
          </SideCard>
        </div>
      </div>
      <p className="mt-[22px] flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <Icon icon={SquareLock02Icon} className="size-3.5" />
        Every view of this case is recorded.
      </p>

      {proposing ? (
        <ProposeDialog
          key={proposing.key}
          open
          onOpenChange={(open) => {
            if (!open) setProposing(null);
          }}
          subject={`${item.reference} · ${item.declarantName}`}
          revising={revising}
          onSubmit={propose}
        />
      ) : null}
      {current && state.kind === 'proposed' ? (
        <Dialog open={withdrawing} onOpenChange={setWithdrawing}>
          <DialogContent busy={busy === 'withdraw'} aria-describedby={undefined}>
            <DialogHeadingPlain title={t.withdrawDialog.title} />
            <DialogBody>
              <p className="text-sm text-secondary-foreground">{t.withdrawDialog.body}</p>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{t.withdrawDialog.cancel}</Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={busy === 'withdraw'}
                onClick={() => void withdraw(current)}
              >
                {busy === 'withdraw' ? <Spinner /> : null}
                {t.withdrawDialog.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Page>
  );
}

function DialogHeadingPlain({ title }: { title: string }) {
  return (
    <div className="px-5 pt-5 pr-16 pb-3 sm:px-6 sm:pt-6 sm:pr-[72px]">
      <h2 className="text-[19px] leading-7 font-semibold tracking-[-0.015em]">{title}</h2>
    </div>
  );
}

function Meta({ icon, children }: { icon: IconProps['icon']; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <Icon icon={icon} className="size-3.5" />
      {children}
    </span>
  );
}

/** Where the determination stands, as a banner with what the viewer may do about it. */
function Banner({
  state,
  busy,
  onWithdraw,
  onRevise,
  onLetter,
}: {
  state: DeterminationState;
  busy: 'withdraw' | 'letter' | null;
  onWithdraw: () => void;
  onRevise: () => void;
  onLetter: (determination: Determination) => void;
}) {
  if (state.kind === 'none') {
    const { propose } = state;
    if (propose === 'allowed' || propose === 'closed') return null;
    const [title, next] =
      propose === 'unassigned'
        ? [t.banner.unassigned, t.banner.unassignedNext]
        : propose === 'clarification-open'
          ? [t.banner.clarificationOpen, t.banner.clarificationOpenNext]
          : [t.banner.heldBy(propose.heldBy.name), t.banner.heldByNext];
    return (
      <BannerFrame variant="neutral" icon={SquareLock02Icon} title={title}>
        <p>{next}</p>
      </BannerFrame>
    );
  }
  const { current } = state;
  if (state.kind === 'proposed') {
    return (
      <BannerFrame
        variant="info"
        icon={Clock01Icon}
        title={t.banner.proposed(current.proposer?.name ?? 'the system', current.proposedAt)}
      >
        {state.withdraw || state.openInApprovals ? (
          <div className="flex flex-wrap gap-2">
            {state.withdraw ? (
              <Button size="sm" variant="secondary" onClick={onWithdraw}>
                <Icon icon={ArrowTurnBackwardIcon} />
                {t.banner.withdraw}
              </Button>
            ) : null}
            {state.openInApprovals ? (
              <Button asChild size="sm" variant="secondary">
                <Link to="/approvals">
                  <Icon icon={StampIcon} />
                  {t.banner.openInApprovals}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </BannerFrame>
    );
  }
  if (state.kind === 'returned') {
    return (
      <BannerFrame
        variant="warning"
        icon={ArrowTurnBackwardIcon}
        title={t.banner.returned(
          current.returnedBy?.name ?? 'A supervisor',
          current.returnedAt ?? current.proposedAt,
        )}
      >
        <p>{current.returnReason}</p>
        {state.revise ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRevise}>
              <Icon icon={PencilEdit02Icon} />
              {t.banner.revise}
            </Button>
          </div>
        ) : null}
      </BannerFrame>
    );
  }
  const further = current.outcome === 'further-action';
  const approver = current.approver?.name ?? 'a supervisor';
  const approvedAt = current.approvedAt ?? current.proposedAt;
  return (
    <BannerFrame
      variant={
        further ? 'warning' : current.outcome === 'non-compliant' ? 'destructive' : 'success'
      }
      icon={further ? ArrowRight02Icon : Tick02Icon}
      title={
        further
          ? t.banner.furtherApproved(approver, approvedAt)
          : t.banner.determined(OUTCOME_BADGE_MESSAGES[current.outcome])
      }
    >
      <p>{further ? t.banner.furtherNext : t.banner.approvedBy(approver, approvedAt)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {current.reference ? (
          <ReferenceChip reference={current.reference} size="sm" className="text-foreground" />
        ) : null}
        {current.letterAvailable ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === 'letter'}
            onClick={() => {
              onLetter(current);
            }}
          >
            {busy === 'letter' ? <Spinner /> : <Icon icon={File01Icon} />}
            {busy === 'letter' ? t.banner.letterPreparing : t.banner.letter}
          </Button>
        ) : null}
      </div>
    </BannerFrame>
  );
}

function BannerFrame({
  variant,
  icon,
  title,
  children,
}: {
  variant: 'neutral' | 'info' | 'warning' | 'success' | 'destructive';
  icon: IconProps['icon'];
  title: string;
  children: ReactNode;
}) {
  return (
    <Alert
      variant={variant}
      role="status"
      className="mb-4 px-5 py-4 [&>svg]:top-[18px] [&>svg]:left-5"
    >
      <Icon icon={icon} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2.5">{children}</AlertDescription>
    </Alert>
  );
}

function SideCard({
  title,
  badge,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 p-0 sm:p-0">
      <CardHeader className="flex-row items-center gap-2.5 border-b px-5 py-4">
        <CardTitle className="text-base">{title}</CardTitle>
        {badge ? <div className="ml-auto">{badge}</div> : null}
      </CardHeader>
      {children}
    </Card>
  );
}

function FlagsCard({ flags }: { flags: CaseView['detail']['flags'] }) {
  const counted = flags.filter((flag) => !flag.closedReason || flag.reviewed);
  const reviewed = counted.filter((flag) => flag.reviewed !== null).length;
  return (
    <SideCard
      title={t.side.flags}
      badge={
        counted.length > 0 ? (
          <Badge variant={reviewed === counted.length ? 'success' : 'warning'}>
            {t.side.flagsReviewed(reviewed, counted.length)}
          </Badge>
        ) : null
      }
    >
      {counted.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t.side.noFlags}</p>
      ) : (
        <ul className="divide-y px-5">
          {counted.map((flag) => (
            <li key={flag.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-3">
              <SeverityBadge severity={flag.severity} />
              <div className="grid gap-0.5">
                <span className="text-[14.5px] font-medium">{flag.title}</span>
                <span className="text-[13px] text-muted-foreground">{flag.indicator}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t px-5 py-3 text-[13px] text-muted-foreground">{t.side.flagsFoot}</p>
    </SideCard>
  );
}

/** The determination as proposed and decided, with every proposal's history under it. */
function DeterminationCard({
  state,
  determinations,
}: {
  state: DeterminationState;
  determinations: readonly Determination[];
}) {
  const current = state.kind === 'none' ? null : state.current;
  const history = determinationHistory(determinations);
  return (
    <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="determination-title">
      <CardHeader className="flex-row items-center gap-2.5 border-b px-5 py-4">
        <CardTitle id="determination-title" className="text-base">
          {t.card.title}
        </CardTitle>
        <div className="ml-auto">
          {current ? (
            <Badge variant={STATUS_VARIANT[current.status]}>{t.card.status[current.status]}</Badge>
          ) : (
            <Badge>{t.card.notProposed}</Badge>
          )}
        </div>
      </CardHeader>
      {current ? (
        <dl className="grid gap-x-6 gap-y-4 px-5 py-5 min-[600px]:grid-cols-2">
          <Fact term={t.card.outcome}>
            <OutcomeBadge outcome={current.outcome} />
          </Fact>
          <Fact term={t.card.reference}>
            {current.reference ? (
              <span className="font-mono text-[13.5px]">{current.reference}</span>
            ) : (
              <span className="text-muted-foreground">{t.card.referencePending}</span>
            )}
          </Fact>
          <Fact term={t.card.proposed}>
            {current.proposer?.name ?? 'The system'}
            <span className="text-muted-foreground"> · {formatDate(current.proposedAt)}</span>
          </Fact>
          <Fact term={t.card.approver}>
            {current.approver ? (
              <>
                {current.approver.name}
                {current.approvedAt ? (
                  <span className="text-muted-foreground"> · {formatDate(current.approvedAt)}</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">{t.card.notApproved}</span>
            )}
          </Fact>
          <Fact term={t.card.reasons} wide>
            <span className="whitespace-pre-line">{current.reasons}</span>
          </Fact>
          {current.furtherActionNote ? (
            <Fact term={t.card.furtherAction} wide>
              <span className="whitespace-pre-line">{current.furtherActionNote}</span>
            </Fact>
          ) : null}
        </dl>
      ) : (
        <EmptyState
          className="py-12"
          icon={<Icon icon={JusticeScale01Icon} />}
          title={t.card.emptyTitle}
          description={t.card.emptyBody}
        />
      )}
      {history.length > 0 ? (
        <section aria-labelledby="determination-history" className="border-t px-5 py-5">
          <h3 id="determination-history" className="mb-3 text-[14.5px] font-semibold">
            {t.card.history}
          </h3>
          <ol className="grid gap-3.5">
            {history.map((entry, index) => (
              <li key={entry.key} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                {index < history.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-7 bottom-[-14px] left-[13.5px] w-px bg-border"
                  />
                ) : null}
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-secondary-foreground">
                  <Icon icon={HISTORY_ICON[entry.kind]} className="size-3.5" />
                </span>
                <div className="grid">
                  <span className="text-[14.5px] font-medium">{entry.title}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {formatDateTime(entry.at)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </Card>
  );
}

function Fact({
  term,
  wide = false,
  children,
}: {
  term: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid content-start gap-1', wide && 'min-[600px]:col-span-2')}>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="text-[14.5px] font-medium">{children}</dd>
    </div>
  );
}
