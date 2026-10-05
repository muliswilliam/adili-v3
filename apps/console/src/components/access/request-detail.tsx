import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  formatDateTime,
  RegisterTimeline,
} from '@adili/ui';

import type { OfficerRequestView } from '../../server/access/types';
import { ReadOnlyBadge } from '../commissions/badges';
import { Page } from '../page';
import { usePollWhile } from '../use-poll-while';
import {
  recordAccessDecisionWrittenNotice,
  recordAccessWrittenNotice,
} from '../../server/access-requests';
import { IdentifyOfficerCard, VerifyApplicantCard } from './action-cards';
import { DecidedCard } from './decision/decided-card';
import { FormKDesktop, FormKDesktopProperties } from './form-k-desktop';
import { PackageCard, usePackageState } from './decision/package-card';
import { FormKCard, formKOf } from './form-k-card';
import { messages as m } from './messages';
import { StatusBadge } from './queue-list';
import { isOpen, nairobiDay, requestStep, timelineOf } from './request-view';
import {
  ClosedCard,
  DecisionCard,
  OfficerCard,
  RepresentationsCard,
  WaitingCard,
} from './side-cards';
import { WrittenNoticeCard } from './written-notice-card';

/** How often, and how many times, the page looks again while the declarant is being notified. */
const NOTIFY_POLL_MS = 2000;
const NOTIFY_POLLS = 15;
/** And while a grant's package is prepared (rendering, watermarking and signing: seconds). */
const PACKAGE_POLL_MS = 3000;
const PACKAGE_POLLS = 20;

/**
 * A Form K request as its Commission's access officer works it and its supervisor reads it
 * (spec 10 FE-5, S3): a desktop reading layout with properties beside it, and the original
 * part-by-part Form K layout on smaller screens. The request step, package and representations
 * remain the same interactive components in either layout.
 */
export function RequestDetailView({
  view,
  readOnly,
  now,
}: {
  view: OfficerRequestView;
  readOnly: boolean;
  now: string;
}) {
  const step = requestStep(view, readOnly);
  const form = formKOf(view);
  const pkg = usePackageState(
    view.decision ?? null,
    view.package ?? null,
    view.packageFailedAt,
    view.timeline.filter((entry) => entry.kind === 'downloaded').map((entry) => entry.at),
    now,
  );
  usePollWhile(step.kind === 'notifying', NOTIFY_POLL_MS, NOTIFY_POLLS);
  usePollWhile(pkg?.state === 'preparing', PACKAGE_POLL_MS, PACKAGE_POLLS);
  // The decision deadline goes in the header until a side card shows it.
  const deadlineInHead =
    isOpen(view) && view.status !== 'awaiting-representations' && view.status !== 'under-decision';

  return (
    <Page className="min-[1200px]:max-w-none min-[1200px]:px-0 min-[1200px]:pt-0 min-[1200px]:pb-0">
      <div className="mb-[22px] flex flex-wrap items-start gap-4 min-[1200px]:hidden">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={view.status} />
            <Badge>{m.formK}</Badge>
            {readOnly ? <ReadOnlyBadge /> : null}
          </div>
          <h1 className="font-mono text-[22px] leading-tight font-semibold tracking-[-0.01em] min-[700px]:text-[24px]">
            {view.reference}
          </h1>
          <p className="mt-1 text-[14.5px] text-muted-foreground">
            {m.receivedLine(form.partI.name, formatDate(view.submittedAt))}
          </p>
        </div>
        {deadlineInHead ? (
          <div className="ml-auto flex items-center gap-2.5 pt-1">
            <DeadlineChip
              due={view.decisionDeadlineAt}
              soonDays={deadlineSoonDays.decision}
              label={m.decisionDue}
            />
            <span className="text-[13.5px] text-muted-foreground">
              {`${m.decisionDue} ${formatDate(view.decisionDeadlineAt)}`}
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(450px,32%)] min-[1200px]:items-stretch min-[1200px]:gap-0 min-[1200px]:overflow-hidden min-[1200px]:bg-card">
        <div className="contents min-[1200px]:block min-[1200px]:min-w-0">
          <div className="order-3 min-w-0 min-[1200px]:order-none">
            <div className="min-[1200px]:hidden">
              <FormKCard view={view} />
            </div>
            <FormKDesktop view={view} />
          </div>
          <div className="order-2 min-w-0 min-[1200px]:order-none min-[1200px]:mx-auto min-[1200px]:w-full min-[1200px]:max-w-[720px] min-[1200px]:px-6 min-[1200px]:pb-6">
            <RepresentationsCard
              view={view}
              readOnly={readOnly}
              readingLayout
              className="min-[1200px]:rounded-none min-[1200px]:bg-transparent min-[1200px]:shadow-none"
            />
          </div>
          <div className="order-4 min-w-0 min-[1200px]:order-none min-[1200px]:mx-auto min-[1200px]:w-full min-[1200px]:max-w-[720px] min-[1200px]:px-6 min-[1200px]:pb-8">
            <section
              className="mb-6 hidden border-t pt-6 min-[1200px]:block"
              aria-label={m.declarationTitle}
            >
              <h2 className="text-sm font-semibold">{m.declarationTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-secondary-foreground">
                {form.partIV.text}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {m.declaredAt(formatDateTime(form.partIV.declaredAt))}
              </p>
            </section>
            <Card
              className="min-w-0 p-0 sm:p-0 min-[1200px]:rounded-none min-[1200px]:border-t min-[1200px]:bg-transparent min-[1200px]:shadow-none"
              role="region"
              aria-labelledby="register-title"
            >
              <CardHeader className="border-b px-5 py-4 min-[1200px]:border-b-0 min-[1200px]:px-0 min-[1200px]:pt-6 min-[1200px]:pb-3">
                <CardTitle id="register-title" className="text-sm">
                  <span className="min-[1200px]:hidden">{m.registerTitle}</span>
                  <span className="hidden min-[1200px]:inline">{m.activityTitle}</span>
                </CardTitle>
              </CardHeader>
              <div className="px-5 py-4.5 min-[1200px]:px-0 min-[1200px]:pt-0">
                <RegisterTimeline
                  entries={timelineOf(view)}
                  label={m.registerLabel}
                  className="[&_li>div>div]:text-sm"
                />
              </div>
            </Card>
          </div>
        </div>
        <aside
          className="order-1 grid min-w-0 content-start gap-4 min-[1200px]:gap-0 min-[1200px]:border-l min-[1200px]:bg-muted/35"
          aria-label={m.whereItStands}
        >
          <div className="grid min-w-0 gap-4 min-[1200px]:p-4 min-[1200px]:pb-0">
            <StepCard view={view} step={step} readOnly={readOnly} now={now} />
          </div>
          <FormKDesktopProperties view={view} readOnly={readOnly} deadlineInHead={deadlineInHead} />
          {pkg ? (
            <div className="min-[1200px]:p-4">
              <PackageCard state={pkg} recipientName={form.partI.name} reference={view.reference} />
            </div>
          ) : null}
          <div className="min-[1200px]:p-4">
            <OfficerCard view={view} />
          </div>
        </aside>
      </div>
    </Page>
  );
}

function StepCard({
  view,
  step,
  readOnly,
  now,
}: {
  view: OfficerRequestView;
  step: ReturnType<typeof requestStep>;
  readOnly: boolean;
  now: string;
}) {
  switch (step.kind) {
    case 'verify':
      return <VerifyApplicantCard view={view} />;
    case 'identify':
      return <IdentifyOfficerCard view={view} now={now} />;
    case 'waiting':
      return <WaitingCard text={step.text} />;
    case 'notifying':
      return null;
    case 'notice':
      return (
        <WrittenNoticeCard
          intro={m.noticeIntro(view.resolvedName ?? m.officerIdentified)}
          invitedAt={view.declarantInvitedAt}
          earliest={nairobiDay(lastResolvedAt(view) ?? view.submittedAt)}
          earliestMessage={m.noticeDayEarly}
          hint={m.noticeDayHint}
          windowDays={view.representationWindowDays ?? undefined}
          now={now}
          success={m.noticeRecorded}
          record={(notifiedOn, idempotencyKey) =>
            recordAccessWrittenNotice({ data: { requestId: view.id, notifiedOn, idempotencyKey } })
          }
        />
      );
    case 'window':
      return <DecisionCard view={view} readOnly={readOnly} windowEndsAt={step.windowEndsAt} />;
    case 'decide':
      return <DecisionCard view={view} readOnly={readOnly} windowEndsAt={null} />;
    case 'decided':
      return view.decision ? (
        <>
          <DecidedCard decision={view.decision} />
          <DecisionNotice
            view={view}
            decidedAt={view.decision.decidedAt}
            readOnly={readOnly}
            now={now}
          />
        </>
      ) : null;
    case 'cannot-identify':
    case 'withdrawn':
      return <ClosedCard view={view} />;
  }
}

/**
 * A decided request whose declarant has no account: the decision goes to them on paper (spec 10
 * decision 2), and the access officer records the day it was served; the supervisor waits.
 */
function DecisionNotice({
  view,
  decidedAt,
  readOnly,
  now,
}: {
  view: OfficerRequestView;
  decidedAt: string;
  readOnly: boolean;
  now: string;
}) {
  if (view.declarantOnboarded !== false || view.decisionNotice !== null) return null;
  if (readOnly) return <WaitingCard text={m.waitingDecisionNotice} />;
  return (
    <WrittenNoticeCard
      title={m.decisionNoticeTitle}
      intro={m.decisionNoticeIntro(view.resolvedName ?? m.officerIdentified)}
      invitedAt={view.declarantInvitedAt}
      invitedOn={m.decisionInvitedOn}
      earliest={nairobiDay(decidedAt)}
      earliestMessage={m.decisionNoticeDayEarly}
      hint={m.decisionNoticeDayHint}
      now={now}
      success={m.decisionNoticeRecorded}
      record={(notifiedOn, idempotencyKey) =>
        recordAccessDecisionWrittenNotice({
          data: { requestId: view.id, notifiedOn, idempotencyKey },
        })
      }
    />
  );
}

/** When the officer was identified: the register's `identified` entry. */
function lastResolvedAt(view: OfficerRequestView): string | null {
  return view.timeline.filter((entry) => entry.kind === 'identified').at(-1)?.at ?? null;
}
