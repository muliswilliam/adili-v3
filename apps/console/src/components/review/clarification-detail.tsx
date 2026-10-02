import {
  Alert,
  AlertDescription,
  AlertTitle,
  type AlertProps,
  Badge,
  type BadgeProps,
  Button,
  Card,
  formatDate,
  Icon,
  plural,
  Tooltip,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Download01Icon,
  File02Icon,
  InboxIcon,
  InformationCircleIcon,
  PencilEdit02Icon,
  RefreshIcon,
  SquareLock02Icon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import {
  getLetterLink,
  getResponseAttachmentLink,
  raiseFollowUpClarification,
  resolveClarification,
  withdrawClarification,
} from '../../server/clarifications';
import type { ClarificationDetail } from '../../server/clarifications.server';
import type { Clarification } from '../../server/review/types';
import type { ServiceError } from '../../server/service-call';
import { clarificationActions } from '../../clarification/actions';
import { CLARIFICATION_STATUSES, REQUIREMENT_LABELS, type Tone } from '../../clarification/labels';
import { historyOf, statusLine } from '../../clarification/view';
import { Page, PageHead, SectionCard } from '../page';
import { ResolveDialog, WithdrawDialog } from './clarification-dialogs';

/**
 * One clarification on a review case (spec 07a FE-4, S15): each item beside the declarant's
 * answer and documents, the letter, where it stands, its history, and for the assignee holding
 * the case the actions: once the declarant has responded, Mark resolved (note) or Raise
 * follow-up (a draft with `followUpOf`); before that, Withdraw (reason; letter revoked).
 * Everyone else reads it.
 */

/** One tone, two components: the badge variant and the callout variant and icon. */
const TONES: Record<
  Tone,
  {
    badge: BadgeProps['variant'];
    alert: AlertProps['variant'];
    icon: Parameters<typeof Icon>[0]['icon'];
  }
> = {
  neutral: { badge: 'default', alert: 'neutral', icon: InformationCircleIcon },
  info: { badge: 'info', alert: 'info', icon: Clock01Icon },
  brand: { badge: 'brand', alert: 'brand', icon: InboxIcon },
  success: { badge: 'success', alert: 'success', icon: CheckmarkCircle02Icon },
  warning: { badge: 'warning', alert: 'warning', icon: Clock01Icon },
  destructive: { badge: 'destructive', alert: 'destructive', icon: Alert02Icon },
};

export function StatusBadge({ status }: { status: Clarification['status'] }) {
  const { label, tone } = CLARIFICATION_STATUSES[status];
  return <Badge variant={TONES[tone].badge}>{label}</Badge>;
}

function failureText(error: ServiceError): string {
  if (error.kind === 'unauthenticated') return 'Your session has ended. Sign in again.';
  if (error.kind === 'problem' && error.problem.status === 403) {
    return 'Only the reviewer holding the case can do this.';
  }
  if (error.kind === 'problem' && error.problem.status === 409) {
    return 'This clarification has changed. Reload to see it.';
  }
  return 'We could not save this. Try again.';
}

/** 403 and 409 mean the page is out of date: say so and reload rather than retry. */
function isStale(error: ServiceError): boolean {
  return error.kind === 'problem' && (error.problem.status === 403 || error.problem.status === 409);
}

export function ClarificationDetailView({
  detail,
  now,
  supervisor,
}: {
  detail: ClarificationDetail;
  now: string;
  supervisor: boolean;
}) {
  const { clarification, mine, windowOpen, othersOpen, original, followUps } = detail;
  const reviewCase = detail.case;
  const router = useRouter();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<'resolve' | 'withdraw' | null>(null);
  const [raising, setRaising] = useState(false);
  const actions = clarificationActions({ status: clarification.status, mine, windowOpen });
  const line = statusLine(clarification, now);

  async function done(
    result: Awaited<ReturnType<typeof resolveClarification>>,
    success: string,
  ): Promise<string | null> {
    if (!result.ok) {
      if (isStale(result.error)) {
        setDialog(null);
        toast({ title: failureText(result.error), urgency: 'assertive' });
        await router.invalidate();
        return null;
      }
      return failureText(result.error);
    }
    setDialog(null);
    toast({ title: success });
    await router.invalidate();
    return null;
  }

  async function followUp() {
    setRaising(true);
    const result = await raiseFollowUpClarification({
      data: { clarificationId: clarification.id },
    });
    setRaising(false);
    if (!result.ok) {
      toast({ title: failureText(result.error), urgency: 'assertive' });
      if (isStale(result.error)) await router.invalidate();
      return;
    }
    toast({ title: 'Further clarification saved as a draft' });
    await navigate({
      to: '/review/cases/$caseId/clarifications/$clarificationId',
      params: { caseId: reviewCase.id, clarificationId: result.data.id },
    });
  }

  const buttons: ReactNode[] = [];
  if (actions.resolve) {
    buttons.push(
      <Button
        key="resolve"
        size="sm"
        onClick={() => {
          setDialog('resolve');
        }}
      >
        <Icon icon={CheckmarkCircle02Icon} />
        Mark resolved
      </Button>,
    );
  }
  if (actions.followUp !== 'hidden') {
    const button = (
      <Button
        key="follow-up"
        size="sm"
        variant="secondary"
        disabled={actions.followUp === 'disabled' || raising}
        onClick={() => void followUp()}
      >
        <Icon icon={RefreshIcon} />
        Raise follow-up
      </Button>
    );
    buttons.push(
      actions.followUp === 'disabled' ? (
        <Tooltip
          key="follow-up"
          content={`The clarification window closed on ${formatDate(reviewCase.windowEndsAt)}.`}
        >
          <span tabIndex={0}>{button}</span>
        </Tooltip>
      ) : (
        button
      ),
    );
  }
  if (actions.withdraw) {
    buttons.push(
      <Button
        key="withdraw"
        size="sm"
        variant="destructive-ghost"
        onClick={() => {
          setDialog('withdraw');
        }}
      >
        <Icon icon={UnavailableIcon} />
        Withdraw
      </Button>,
    );
  }

  const readOnly =
    !mine && ['issued', 'responded', 'overdue', 'draft'].includes(clarification.status);
  const meta = [
    <span key="case">
      re: <span className="font-mono">{reviewCase.reference}</span>
    </span>,
    plural(clarification.items.length, 'item'),
    clarification.issuedAt ? `Issued ${formatDate(clarification.issuedAt)}` : 'Draft',
    clarification.dueAt ? `Due ${formatDate(clarification.dueAt)}` : null,
  ].filter(Boolean);

  return (
    <Page>
      <PageHead title={reviewCase.declarantName} actions={buttons.length > 0 ? buttons : undefined}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {clarification.reference ? (
            <span className="font-mono text-sm font-semibold">{clarification.reference}</span>
          ) : null}
          <StatusBadge status={clarification.status} />
          {clarification.responseLate ? <Badge variant="warning">Late</Badge> : null}
        </div>
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          {meta.map((part, index) => (
            <span key={index}>
              {index > 0 ? '· ' : ''}
              {part}
            </span>
          ))}
        </p>
      </PageHead>

      {readOnly ? (
        <p className="-mt-2 mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon icon={SquareLock02Icon} className="size-4" />
          <span>
            Read-only.{' '}
            {reviewCase.assignee
              ? `${reviewCase.assignee.name} holds this case.`
              : 'Nobody holds this case yet.'}
            {supervisor ? ' Reassign it to act.' : ''}
          </span>
        </p>
      ) : null}

      <div className="grid gap-4">
        <Alert variant={TONES[line.tone].alert} role="status">
          <Icon icon={TONES[line.tone].icon} />
          <AlertTitle>{line.title}</AlertTitle>
          {line.body ? <AlertDescription>{line.body}</AlertDescription> : null}
        </Alert>

        {original ? (
          <p className="text-sm">
            Further clarification on{' '}
            <Link
              to="/review/cases/$caseId/clarifications/$clarificationId"
              params={{ caseId: reviewCase.id, clarificationId: original.id }}
              className="font-mono underline"
            >
              {original.reference ?? 'a draft'}
            </Link>
          </p>
        ) : null}
        {followUps.map((each) => (
          <p key={each.id} className="text-sm">
            {each.status === 'draft'
              ? 'Further clarification drafted: '
              : 'Further clarification issued: '}
            <Link
              to="/review/cases/$caseId/clarifications/$clarificationId"
              params={{ caseId: reviewCase.id, clarificationId: each.id }}
              className="font-mono underline"
            >
              {each.reference ?? 'Draft'}
            </Link>
          </p>
        ))}

        <ItemsAndResponses clarification={clarification} caseId={reviewCase.id} />
        {clarification.letter ? <LetterCard letter={clarification.letter} /> : null}
        <HistoryCard clarification={clarification} now={now} />
        <p className="text-xs text-muted-foreground">
          Your access to this declaration is recorded in the audit trail.
        </p>
      </div>

      <ResolveDialog
        open={dialog === 'resolve'}
        onOpenChange={(open) => {
          setDialog(open ? 'resolve' : null);
        }}
        reference={clarification.reference}
        othersOpen={othersOpen}
        onSubmit={async (note) =>
          done(
            await resolveClarification({ data: { clarificationId: clarification.id, note } }),
            'Clarification resolved',
          )
        }
      />
      <WithdrawDialog
        open={dialog === 'withdraw'}
        onOpenChange={(open) => {
          setDialog(open ? 'withdraw' : null);
        }}
        reference={clarification.reference}
        onSubmit={async (reason) =>
          done(
            await withdrawClarification({ data: { clarificationId: clarification.id, reason } }),
            'Clarification withdrawn',
          )
        }
      />
    </Page>
  );
}

/** Follows a short-lived download link, or says it could not be had. */
function useDownload() {
  const { toast } = useToast();
  return async (
    link: Promise<{ ok: true; data: { downloadUrl: string } } | { ok: false }>,
    failed: string,
  ) => {
    const result = await link.catch(() => ({ ok: false }) as const);
    if (result.ok) window.location.assign(result.data.downloadUrl);
    else toast({ title: failed });
  };
}

function ItemsAndResponses({
  clarification,
  caseId,
}: {
  clarification: Clarification;
  caseId: string;
}) {
  const download = useDownload();
  const { items, response, status } = clarification;
  const none =
    status === 'withdrawn'
      ? 'Withdrawn before a response.'
      : status === 'draft'
        ? 'Not sent yet.'
        : 'No response yet.';
  return (
    <ol className="grid gap-3" aria-label="Items and responses">
      {items.map((item, index) => {
        const answer = response?.items.find((each) => each.index === index);
        return (
          <li key={index}>
            <Card className="grid gap-4 p-0 sm:p-0 min-[900px]:grid-cols-2 min-[900px]:gap-0">
              <div className="grid content-start gap-2 p-5">
                <p className="text-xs font-medium text-muted-foreground">
                  {index + 1}. What we asked
                </p>
                {item.label ? <p className="font-medium">{item.label}</p> : null}
                <Badge variant="default">{REQUIREMENT_LABELS[item.requirement]}</Badge>
                <p className="text-sm">{item.text}</p>
              </div>
              <div className="grid content-start gap-2 border-t p-5 min-[900px]:border-t-0 min-[900px]:border-l">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Icon icon={InboxIcon} className="size-3.5" />
                  Response
                </p>
                {answer ? (
                  <>
                    <p className="text-sm whitespace-pre-line">{answer.text}</p>
                    {answer.attachments.length > 0 ? (
                      <ul
                        className="grid gap-2"
                        aria-label={`Documents for item ${String(index + 1)}`}
                      >
                        {answer.attachments.map((file) => (
                          <li
                            key={file.uploadId}
                            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                          >
                            <Icon icon={File02Icon} className="size-4 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label={`Download ${file.fileName}`}
                              onClick={() => {
                                void download(
                                  getResponseAttachmentLink({
                                    data: { caseId, uploadId: file.uploadId },
                                  }),
                                  'The document could not be downloaded. Try again.',
                                );
                              }}
                            >
                              <Icon icon={Download01Icon} />
                              Download
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No attachments</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{none}</p>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

function LetterCard({ letter }: { letter: NonNullable<Clarification['letter']> }) {
  const download = useDownload();
  return (
    <SectionCard id="clarification-letter" icon={File02Icon} title="Clarification letter">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
        {letter.status === 'pending' ? (
          <span className="text-muted-foreground">Producing the letter…</span>
        ) : (
          <>
            <Badge variant={letter.status === 'revoked' ? 'destructive' : 'success'}>
              {letter.status === 'revoked' ? 'Revoked' : 'Issued'}
            </Badge>
            <span>
              Verification code <b className="font-mono">{letter.verificationId}</b>
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => {
                void download(
                  getLetterLink({ data: { documentId: letter.documentId } }),
                  'The letter could not be downloaded. Try again.',
                );
              }}
            >
              <Icon icon={Download01Icon} />
              Download PDF
            </Button>
          </>
        )}
      </div>
    </SectionCard>
  );
}

function HistoryCard({ clarification, now }: { clarification: Clarification; now: string }) {
  const entries = historyOf(clarification, now);
  if (entries.length === 0) return null;
  return (
    <SectionCard id="clarification-history" icon={PencilEdit02Icon} title="History">
      <ol className="grid gap-3 px-5 py-4">
        {entries.map((entry) => (
          <li key={entry.key} className="grid gap-0.5 border-l-2 border-border pl-3">
            <span className="text-sm font-medium">{entry.title}</span>
            {entry.at ? <span className="text-sm text-muted-foreground">{entry.at}</span> : null}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
