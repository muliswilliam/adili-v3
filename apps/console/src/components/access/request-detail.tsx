import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  RegisterTimeline,
} from '@adili/ui';

import type { OfficerRequestView } from '../../server/access/types';
import { ReadOnlyBadge } from '../commissions/badges';
import { Page } from '../page';
import { usePollWhile } from '../use-poll-while';
import { IdentifyOfficerCard, VerifyApplicantCard } from './action-cards';
import { DecidedCard } from './decision/decided-card';
import { PackageCard, usePackageState } from './decision/package-card';
import { FormKCard, formKOf } from './form-k-card';
import { messages as m } from './messages';
import { StatusBadge } from './queue-list';
import { isOpen, requestStep, timelineOf } from './request-view';
import {
  ClosedCard,
  DecisionCard,
  OfficerCard,
  RepresentationsCard,
  WaitingCard,
} from './side-cards';

/** How often, and how many times, the page looks again while the declarant is being notified. */
const NOTIFY_POLL_MS = 2000;
const NOTIFY_POLLS = 15;
/** And while a grant's package is prepared (rendering, watermarking and signing: seconds). */
const PACKAGE_POLL_MS = 3000;
const PACKAGE_POLLS = 20;

/**
 * A Form K request as its Commission's access officer works it and its supervisor reads it
 * (spec 10 FE-5, S3): Form K by part and the access register on the left; on the right the step
 * it is at (verify the applicant, identify the officer, wait for representations, decide), the
 * officer identified and the declarant's representations.
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
    view.timeline.filter((entry) => entry.kind === 'downloaded').map((entry) => entry.at),
    now,
  );
  usePollWhile(step.kind === 'notifying', NOTIFY_POLL_MS, NOTIFY_POLLS);
  usePollWhile(pkg?.state === 'preparing', PACKAGE_POLL_MS, PACKAGE_POLLS);
  // The decision deadline goes in the header until a side card shows it.
  const deadlineInHead =
    isOpen(view) && view.status !== 'awaiting-representations' && view.status !== 'under-decision';

  return (
    <Page>
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
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

      <div className="grid items-start gap-4 min-[1080px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-4">
          <FormKCard view={view} />
          <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="register-title">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle id="register-title">{m.registerTitle}</CardTitle>
            </CardHeader>
            <div className="px-5 py-4.5">
              <RegisterTimeline entries={timelineOf(view)} label={m.registerLabel} />
            </div>
          </Card>
        </div>
        <aside
          className="order-first grid min-w-0 gap-4 min-[1080px]:order-none"
          aria-label={m.whereItStands}
        >
          <StepCard view={view} step={step} readOnly={readOnly} now={now} />
          {pkg ? (
            <PackageCard state={pkg} recipientName={form.partI.name} reference={view.reference} />
          ) : null}
          <OfficerCard view={view} />
          <RepresentationsCard view={view} />
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
    case 'window':
      return <DecisionCard view={view} readOnly={readOnly} windowEndsAt={step.windowEndsAt} />;
    case 'decide':
      return <DecisionCard view={view} readOnly={readOnly} windowEndsAt={null} />;
    case 'decided':
      return view.decision ? <DecidedCard decision={view.decision} /> : null;
    case 'cannot-identify':
    case 'withdrawn':
      return <ClosedCard view={view} />;
  }
}
