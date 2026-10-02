import {
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
  Spinner,
  useToast,
} from '@adili/ui';
import {
  Attachment01Icon,
  CheckmarkCircle02Icon,
  Download01Icon,
  JusticeScale01Icon,
  Message01Icon,
  SquareLock02Icon,
  UnavailableIcon,
  Undo02Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { getRepresentationAttachmentLink } from '../../server/access-requests';
import type { OfficerRequestView, Representations } from '../../server/access/types';
import { downloadFrom } from '../download';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { lastEntry } from './request-view';

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

/** Text on a muted panel: where a step stands, or nothing yet. */
export function Muted({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground">
      {children}
    </div>
  );
}

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
          {m.decisionOpensWhen(formatDate(windowEndsAt))}
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
  tone: 'success' | 'destructive' | 'muted';
  children: ReactNode;
}) {
  const tint =
    tone === 'success'
      ? 'bg-success-subtle text-success'
      : tone === 'destructive'
        ? 'bg-destructive-subtle text-destructive'
        : 'bg-muted text-muted-foreground';
  return (
    <div className="flex items-center gap-2.5 text-[16px] font-semibold">
      <span className={`grid size-8 place-items-center rounded-full ${tint}`} aria-hidden="true">
        <Icon icon={icon} className="size-4" strokeWidth={2.2} />
      </span>
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
      <OutcomeLine icon={cannot ? UserRemove01Icon : Undo02Icon} tone="muted">
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

/** The roster record the officer Form K names was identified as, and when they were notified. */
export function OfficerCard({ view }: { view: OfficerRequestView }) {
  if (!view.resolvedName) return null;
  const notified = lastEntry(view, 'notified');
  return (
    <SideCard id="officer">
      <dl className="grid gap-3.5 text-sm">
        <div>
          <dt className="text-[13px] text-muted-foreground">{m.officerIdentified}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold">{view.resolvedName}</dd>
          {view.resolvedFileNumber ? (
            <dd className="text-[13px] text-muted-foreground">
              {m.fileNumber(view.resolvedFileNumber)}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">{m.notified}</dt>
          <dd className="mt-0.5 font-medium">
            {notified ? (
              formatDateTime(notified.at)
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
 */
export function RepresentationsCard({ view }: { view: OfficerRequestView }) {
  const { toast } = useToast();
  if (!view.windowEndsAt) return null;
  const reps = view.representations;
  const open = view.status === 'awaiting-representations';

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
      {!reps ? (
        <Muted>
          {open
            ? m.noneYet(formatDate(view.windowEndsAt))
            : m.noneReceived(formatDate(view.windowEndsAt))}
        </Muted>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STANCE_STYLE[reps.stance].variant}>
              <Icon icon={STANCE_STYLE[reps.stance].icon} strokeWidth={2.2} />
              {m.stance[reps.stance]}
            </Badge>
            <span className="text-[13px] text-muted-foreground">
              {reps.updatedAt !== reps.submittedAt
                ? m.edited(formatDateTime(reps.updatedAt))
                : formatDateTime(reps.submittedAt)}
            </span>
          </div>
          {reps.text ? (
            <p className="text-sm leading-relaxed whitespace-pre-line">{reps.text}</p>
          ) : null}
          {reps.attachments.length > 0 ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label={m.attachmentsLabel}>
              {reps.attachments.map((file) => (
                <li
                  key={file.uploadId}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
                  >
                    <Icon icon={Attachment01Icon} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={file.fileName}>
                      {file.fileName}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.scannedClean}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 [&_svg]:size-4"
                    aria-label={m.openAttachment(file.fileName)}
                    onClick={() => void download(file.uploadId)}
                  >
                    <Icon icon={Download01Icon} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {reps.stance === 'consent' ? (
            <p className="text-[13px] text-muted-foreground">{m.consentClosedEarly}</p>
          ) : null}
        </>
      )}
    </SideCard>
  );
}
