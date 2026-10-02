import {
  AttachmentList,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  formatDateTime,
  Icon,
  type IconProps,
  IconTile,
  MenuItem,
  Spinner,
  useToast,
} from '@adili/ui';
import {
  CheckmarkCircle02Icon,
  Download01Icon,
  File01Icon,
  JusticeScale01Icon,
  Message01Icon,
  SquareLock02Icon,
  UnavailableIcon,
  Undo02Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { getRepresentationAttachmentLink } from '../../server/access-requests';
import type { OfficerRequestView, Representations } from '../../server/access/types';
import { downloadFrom } from '../download';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { Muted } from './muted';
import {
  awaitingNotice,
  formatDay,
  lastEntry,
  lastInstantOf,
  nairobiDay,
  notifiedInWriting,
} from './request-view';
import { WrittenRepresentationsDialog } from './written-representations-dialog';

/** A side card: a title on a hairline header, then its body (the prototype's `.sec-h`/`.sec-b`). */
export function SideCard({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <Card
      className="min-w-0 p-0 sm:p-0"
      role="region"
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : id}
    >
      {title ? (
        <CardHeader className="flex-row items-center gap-2 border-b px-5 py-4">
          <CardTitle id={headingId}>{title}</CardTitle>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </CardHeader>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 px-5 py-4.5">{children}</div>
    </Card>
  );
}

export { Muted } from './muted';

/** Where a step only the access officer takes stands, for the supervisor. */
export function WaitingCard({ text }: { text: string }) {
  return (
    <SideCard id="waiting">
      <Muted>{text}</Muted>
    </SideCard>
  );
}

function decisionChip(view: OfficerRequestView) {
  return (
    <DeadlineChip
      due={view.decisionDeadlineAt}
      soonDays={deadlineSoonDays.decision}
      label={m.decisionDue}
    />
  );
}

/**
 * The decision while it waits for representations (Decide stays locked), or is the access
 * officer's to take (Decide opens the decision form, #260); the supervisor only reads.
 */
export function DecisionCard({
  view,
  readOnly,
  windowEndsAt,
}: {
  view: OfficerRequestView;
  readOnly: boolean;
  /** Set while the declarant's window is open. */
  windowEndsAt: string | null;
}) {
  return (
    <SideCard id="decision" title={m.decisionTitle} actions={decisionChip(view)}>
      {windowEndsAt ? (
        <p className="text-sm text-muted-foreground">
          {m.decisionOpensWhen(formatDate(lastInstantOf(windowEndsAt)))}
        </p>
      ) : readOnly ? (
        <Muted>{m.decisionReadOnly}</Muted>
      ) : (
        <p className="text-sm text-muted-foreground">{m.decisionOpen}</p>
      )}
      {readOnly ? null : windowEndsAt ? (
        <Button variant="secondary" disabled>
          <Icon icon={SquareLock02Icon} />
          {m.decide}
        </Button>
      ) : (
        <Button asChild>
          <Link to="/access/requests/$requestId/decide" params={{ requestId: view.id }}>
            <Icon icon={JusticeScale01Icon} />
            {m.decide}
          </Link>
        </Button>
      )}
    </SideCard>
  );
}

/** An outcome with its tinted icon: decided, or closed without a decision. */
export function OutcomeLine({
  icon,
  tone,
  children,
}: {
  icon: IconProps['icon'];
  tone: 'success' | 'destructive' | 'default';
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 text-[16px] font-semibold">
      {/* Round, as the prototype's outcome mark. */}
      <IconTile tone={tone} size="sm" className="rounded-full [&_svg]:size-4">
        <Icon icon={icon} strokeWidth={2.2} />
      </IconTile>
      {children}
    </div>
  );
}

/** Closed without a decision: the officer cannot be identified, or the applicant withdrew. */
export function ClosedCard({ view }: { view: OfficerRequestView }) {
  const cannot = view.status === 'cannot-identify';
  const closed = lastEntry(view, cannot ? 'cannot-identify' : 'withdrawn');
  return (
    <SideCard id="closed" title={m.closedTitle}>
      <OutcomeLine icon={cannot ? UserRemove01Icon : Undo02Icon} tone="default">
        {cannot ? m.cannotIdentifyOutcome : m.withdrawnOutcome}
      </OutcomeLine>
      {closed ? (
        <p className="text-sm text-muted-foreground">
          {cannot
            ? m.cannotIdentifyBy(closed.actor ?? m.title, formatDateTime(closed.at))
            : m.withdrawnBy(formatDateTime(closed.at))}
        </p>
      ) : null}
    </SideCard>
  );
}

/**
 * The roster record the officer Form K names was identified as, and when and how they were
 * notified: online, or in writing (an officer with no account, invited to onboard meanwhile).
 */
export function OfficerCard({ view }: { view: OfficerRequestView }) {
  if (!view.resolvedName) return null;
  const notified = lastEntry(view, 'notified');
  const notice = view.notice;
  return (
    <SideCard id="officer" title={m.officerIdentified}>
      <dl className="grid gap-3.5 text-sm">
        <div>
          <dt className="text-[13px] text-muted-foreground">{m.declarant}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold">{view.resolvedName}</dd>
          {view.resolvedFileNumber ? (
            <dd className="text-[13px] text-muted-foreground">
              {m.fileNumber(view.resolvedFileNumber)}
            </dd>
          ) : null}
        </div>
        {view.declarantOnboarded === false ? (
          <div>
            <dt className="text-[13px] text-muted-foreground">{m.declarantAccount}</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2">
              <Badge variant="warning">{m.accountNone}</Badge>
              {view.declarantInvitedAt ? (
                <span className="text-[13px] text-muted-foreground">
                  {m.accountInvited(formatDay(nairobiDay(view.declarantInvitedAt)))}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[13px] text-muted-foreground">{m.notified}</dt>
          <dd className="mt-0.5 font-medium">
            {notice?.channel === 'written' && notice.notifiedOn ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <Icon icon={File01Icon} className="size-3.5 text-muted-foreground" />
                  {m.notifiedInWriting(formatDay(notice.notifiedOn))}
                </span>
                {notice.recordedBy && notified ? (
                  <span className="block text-[13px] font-normal text-muted-foreground">
                    {m.recordedBy(notice.recordedBy, formatDateTime(notified.at))}
                  </span>
                ) : null}
              </>
            ) : notified ? (
              formatDateTime(notified.at)
            ) : awaitingNotice(view) ? (
              <span className="font-normal text-muted-foreground">{m.awaitingNotice}</span>
            ) : (
              <span
                className="inline-flex items-center gap-2 font-normal text-muted-foreground"
                role="status"
              >
                <Spinner className="size-3.5" />
                {m.notifying}
              </span>
            )}
          </dd>
        </div>
        {view.decisionNotice?.notifiedOn ? (
          <div>
            <dt className="text-[13px] text-muted-foreground">{m.decisionToldTerm}</dt>
            <dd className="mt-0.5 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Icon icon={File01Icon} className="size-3.5 text-muted-foreground" />
                {m.notifiedInWriting(formatDay(view.decisionNotice.notifiedOn))}
              </span>
              {view.decisionNotice.recordedBy ? (
                <span className="block text-[13px] font-normal text-muted-foreground">
                  {m.recordedBy(
                    view.decisionNotice.recordedBy,
                    formatDateTime(lastEntry(view, 'decision-notified')?.at ?? ''),
                  )}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </SideCard>
  );
}

const STANCE_STYLE: Record<
  Representations['stance'],
  { variant: 'destructive' | 'success' | 'info'; icon: IconProps['icon'] }
> = {
  object: { variant: 'destructive', icon: UnavailableIcon },
  consent: { variant: 'success', icon: CheckmarkCircle02Icon },
  context: { variant: 'info', icon: Message01Icon },
};

/**
 * The declarant's representations (s.36(3)) once they were notified: stance, text and files, or
 * that there are none yet, or none came before the window closed. The supervisor reads them too.
 * Representations received in writing say so, with who entered them; on a request notified in
 * writing the access officer enters them while the window is open.
 */
export function RepresentationsCard({
  view,
  readOnly,
}: {
  view: OfficerRequestView;
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const [entering, setEntering] = useState(false);
  if (!view.windowEndsAt) return null;
  const reps = view.representations;
  const open = view.status === 'awaiting-representations';
  const canEnter = !readOnly && open && notifiedInWriting(view);
  const when = !reps
    ? ''
    : reps.updatedAt !== reps.submittedAt
      ? m.edited(formatDateTime(reps.updatedAt))
      : formatDateTime(reps.submittedAt);

  const download = async (uploadId: string) => {
    const result = await getRepresentationAttachmentLink({
      data: { requestId: view.id, uploadId },
    }).catch(() => null);
    if (result?.ok) {
      downloadFrom(result.data.downloadUrl);
      return;
    }
    if (result?.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    toast({ title: m.attachmentFailed, urgency: 'assertive' });
  };

  return (
    <SideCard id="representations" title={m.representationsTitle}>
      {canEnter && entering ? (
        <WrittenRepresentationsDialog view={view} open={entering} onOpenChange={setEntering} />
      ) : null}
      {!reps ? (
        <Muted>
          {open
            ? m.noneYet(formatDate(lastInstantOf(view.windowEndsAt)))
            : m.noneReceived(formatDate(lastInstantOf(view.windowEndsAt)))}
        </Muted>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STANCE_STYLE[reps.stance].variant}>
              <Icon icon={STANCE_STYLE[reps.stance].icon} strokeWidth={2.2} />
              {m.stance[reps.stance]}
            </Badge>
            {reps.receivedInWriting ? (
              <Badge>
                <Icon icon={File01Icon} strokeWidth={2.2} />
                {m.receivedInWriting}
              </Badge>
            ) : null}
            {reps.receivedInWriting ? null : (
              <span className="text-[13px] text-muted-foreground">{when}</span>
            )}
          </div>
          {reps.receivedInWriting ? (
            <p className="-mt-1 text-[13px] text-muted-foreground">
              {reps.recordedBy ? `${m.enteredBy(reps.recordedBy)} · ${when}` : when}
            </p>
          ) : null}
          {reps.text ? (
            <p className="text-sm leading-relaxed whitespace-pre-line">{reps.text}</p>
          ) : null}
          {reps.attachments.length > 0 ? (
            <AttachmentList
              label={m.attachmentsLabel}
              attachments={reps.attachments.map((file) => ({
                id: file.uploadId,
                name: file.fileName,
                status: 'linked',
                detail: m.scannedClean,
              }))}
              messages={{ actions: m.attachmentActions }}
              menuItems={(file) => (
                <MenuItem
                  icon={Download01Icon}
                  onSelect={() => {
                    void download(file.id);
                  }}
                >
                  {m.download}
                </MenuItem>
              )}
            />
          ) : null}
          {reps.stance === 'consent' ? (
            <p className="text-[13px] text-muted-foreground">{m.consentClosedEarly}</p>
          ) : null}
        </>
      )}
      {canEnter ? (
        <Button
          variant="secondary"
          onClick={() => {
            setEntering(true);
          }}
        >
          <Icon icon={File01Icon} />
          {reps ? m.updateWritten : m.enterWritten}
        </Button>
      ) : null}
    </SideCard>
  );
}
