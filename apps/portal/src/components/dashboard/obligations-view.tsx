import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  formatDate,
  Icon,
  obligationTypeLabel,
  remindersSentLabel,
  Skeleton,
  StatementDateTerm,
} from '@adili/ui';
import { AlertCircleIcon, Calendar03Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { type MouseEvent, type ReactNode, Suspense, use, useId, useState } from 'react';

import type { Obligation, ObligationGroup } from '../../server/declarations/types';
import type { MyObligationsResult } from '../../server/obligations.server';
import { useDrafts } from './drafts';
import { ObligationDrawer } from './obligation-drawer';
import { messages as m } from './obligation-messages';
import {
  type LoadObligationDetail,
  ObligationStatus,
  OverdueNote,
  SessionEnded,
  StartDeclarationButton,
} from './obligation-parts';
import { dashboardGroups, type StartAvailability, startAvailability } from './obligations';

interface SectionProps {
  /** `getMyObligations`, started by the route loader so the page does not wait for it. */
  obligations: Promise<MyObligationsResult>;
  /** Asks again, for the retry after a failure. */
  reload: () => Promise<MyObligationsResult>;
  loadDetail: LoadObligationDetail;
  /** Epoch milliseconds to count days from; defaults to now. */
  now?: number;
}

/**
 * The dashboard's obligations: skeleton cards while `getMyObligations` is on its way, then the
 * obligations, the empty state or an error with a retry. Nothing at all for someone who is not
 * a declarant (404), so the dashboard shows the account card alone. Drafts to continue come
 * from the nearest `DraftsProvider`.
 */
export function ObligationsSection({ obligations, reload, loadDetail, now }: SectionProps) {
  const [pending, setPending] = useState({ from: obligations, promise: obligations });
  // A new loader run (after navigation or invalidation) replaces a retried request.
  const promise = pending.from === obligations ? pending.promise : obligations;
  return (
    <Suspense fallback={<ObligationsSkeleton />}>
      <Resolved
        promise={promise}
        onRetry={() => {
          setPending({ from: obligations, promise: reload() });
        }}
        loadDetail={loadDetail}
        now={now}
      />
    </Suspense>
  );
}

function Resolved({
  promise,
  ...props
}: Omit<ViewProps, 'result'> & { promise: Promise<MyObligationsResult> }) {
  return <ObligationsView result={use(promise)} {...props} />;
}

interface ViewProps {
  result: MyObligationsResult;
  onRetry: () => void;
  loadDetail: LoadObligationDetail;
  now?: number;
}

/** The loaded obligations, grouped by Commission when there is more than one; see `dashboardGroups`. */
export function ObligationsView({ result, onRetry, loadDetail, now }: ViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const drafts = useDrafts();
  const headingId = useId();
  if (result.status === 'not-declarant') return null;

  const heading = (
    <h2 id={headingId} className="sr-only">
      {m.heading}
    </h2>
  );

  if (result.status === 'unauthenticated') {
    return (
      <section aria-labelledby={headingId}>
        {heading}
        <SessionEnded />
      </section>
    );
  }

  if (result.status === 'unavailable') {
    return (
      <section aria-labelledby={headingId}>
        {heading}
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertTitle>{m.errorTitle}</AlertTitle>
          <AlertDescription className="grid justify-items-start gap-2.5">
            <p>{m.errorDetail}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <Icon icon={RefreshIcon} />
              {m.tryAgain}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const groups = dashboardGroups(result.groups);
  if (groups.length === 0) {
    return (
      <section aria-labelledby={headingId}>
        {heading}
        <Card className="p-0 sm:p-0">
          <EmptyState
            icon={<Icon icon={Calendar03Icon} />}
            title={m.emptyTitle}
            description={m.emptyText}
          />
        </Card>
      </section>
    );
  }

  const grouped = groups.length > 1;
  const open = groups.flatMap((group) => group.obligations).find((entry) => entry.id === openId);
  const cards = (group: ObligationGroup) => (
    <div className="grid gap-3.5">
      {group.obligations.map((obligation) => (
        <ObligationCard
          key={obligation.id}
          obligation={obligation}
          headingLevel={grouped ? 4 : 3}
          onOpen={() => {
            setOpenId(obligation.id);
          }}
          availability={startAvailability(obligation, drafts)}
          now={now}
        />
      ))}
    </div>
  );

  return (
    <section aria-labelledby={headingId} className="grid gap-4.5">
      {heading}
      {grouped
        ? groups.map((group) => (
            <div key={group.commission.slug} className="grid gap-2.5">
              <h3 className="flex items-center gap-2.5 text-[13.5px] font-semibold text-secondary-foreground">
                <span className="flex h-[22px] items-center rounded-sm bg-muted px-[7px] font-mono text-[11px] font-semibold">
                  {group.commission.issuerCode}
                </span>
                {group.commission.name}
              </h3>
              {cards(group)}
            </div>
          ))
        : groups[0] && cards(groups[0])}
      {open ? (
        <ObligationDrawer
          obligation={open}
          open
          onOpenChange={(next) => {
            if (!next) setOpenId(null);
          }}
          loadDetail={loadDetail}
          availability={startAvailability(open, drafts)}
          now={now}
        />
      ) : null}
    </section>
  );
}

const cardTone = {
  // A warm tint and a glow in the corner for what needs doing now, as in the prototype.
  due: 'bg-linear-135 from-brand-faint to-brand-subtle before:from-brand/14',
  overdue: 'bg-linear-135 from-warning-subtle/50 to-warning-subtle before:from-warning/12',
  upcoming: '',
  filed: 'bg-linear-135 from-success-subtle/50 to-success-subtle',
  cancelled: '',
} satisfies Record<Obligation['status'], string>;

function ObligationCard({
  obligation,
  headingLevel,
  onOpen,
  availability,
  now,
}: {
  obligation: Obligation;
  headingLevel: 3 | 4;
  onOpen: () => void;
  availability: StartAvailability;
  now?: number;
}) {
  const { status } = obligation;
  const title = obligationTypeLabel(obligation.type, obligation.statementDate);
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const headingId = useId();
  const pressing = status === 'due' || status === 'overdue';
  return (
    // The whole card opens the drawer for pointer users; Details is the keyboard way in.
    <Card
      asChild
      className={cn(
        'relative cursor-pointer overflow-hidden transition-shadow hover:shadow-control-hover',
        pressing &&
          'before:pointer-events-none before:absolute before:top-0 before:right-0 before:h-50 before:w-60 before:bg-radial-[circle_at_100%_0] before:to-transparent before:to-65%',
        cardTone[status],
      )}
    >
      <article
        aria-labelledby={headingId}
        onClick={(event: MouseEvent) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest('button, a, [tabindex]')
          ) {
            onOpen();
          }
        }}
      >
        <div className="relative flex flex-wrap items-center gap-2">
          <ObligationStatus obligation={obligation} now={now} onCard />
          {availability.kind === 'continue' ? (
            <Badge variant="brand">{m.draftInProgress}</Badge>
          ) : null}
        </div>
        <Heading
          id={headingId}
          className="relative mt-2.5 text-xl leading-tight font-semibold tracking-tight"
        >
          {title}
        </Heading>
        <dl className="relative mt-4.5 mb-5 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-[repeat(3,auto)] sm:justify-start sm:gap-x-10">
          <CardFact
            pressing={pressing}
            term={
              <StatementDateTerm hint={m.statementDateTip}>{m.statementDate}</StatementDateTerm>
            }
          >
            {formatDate(obligation.statementDate)}
          </CardFact>
          <CardFact pressing={pressing} term={m.due}>
            {formatDate(obligation.dueDate)}
          </CardFact>
          <CardFact pressing={pressing} term={m.reminders} className="col-span-2 sm:col-span-1">
            {remindersSentLabel(obligation.remindersSent)}
          </CardFact>
        </dl>
        {status === 'overdue' ? <OverdueNote className="relative -mt-1.5 mb-4" /> : null}
        <div className="relative flex flex-wrap items-center gap-2.5">
          <StartDeclarationButton obligationId={obligation.id} availability={availability} />
          <Button variant="secondary" onClick={onOpen}>
            {m.details}
            <span className="sr-only">{m.detailsOf(title)}</span>
          </Button>
        </div>
      </article>
    </Card>
  );
}

function CardFact({
  term,
  pressing,
  className,
  children,
}: {
  term: ReactNode;
  pressing: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid content-start gap-0.5', className)}>
      <dt
        className={cn(
          'text-[12.5px] font-medium',
          pressing ? 'text-secondary-foreground' : 'text-muted-foreground',
        )}
      >
        {term}
      </dt>
      <dd className="text-[15px] font-semibold">{children}</dd>
    </div>
  );
}

/** Two card-shaped placeholders while the obligations load. */
export function ObligationsSkeleton() {
  return (
    <section aria-busy="true" aria-label={m.loading} className="grid gap-3.5">
      {[0, 1].map((key) => (
        <Card key={key} className="grid gap-3">
          <Skeleton className="h-6 w-22 rounded-full" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="w-4/5" />
          <Skeleton className="w-2/5" />
          <Skeleton className="h-11 w-40 rounded-lg" />
        </Card>
      ))}
    </section>
  );
}
