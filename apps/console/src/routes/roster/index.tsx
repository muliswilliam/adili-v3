import {
  Badge,
  Button,
  Card,
  Icon,
  type IconProps,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  ProgressBar,
  Skeleton,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Download04Icon,
  File02Icon,
  Flag02Icon,
  Key01Icon,
  LeftToRightListBulletIcon,
  Search01Icon,
  Upload04Icon,
  UserCheck01Icon,
  UserGroupIcon,
  Xls02Icon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ReadOnlyBadge } from '../../components/commissions/badges';
import { formatDateTime, formatNumber, formatRelativeTime } from '../../components/format';
import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { type CredentialState, credentialState } from '../../components/roster/api-credential';
import { onboardedPercent, toOnboard } from '../../components/roster/coverage';
import { messages as m } from '../../components/roster/messages';
import { type NextStep, nextSteps } from '../../components/roster/next-steps';
import { ImportChannelBadge, ImportStateBadge } from '../../components/roster/roster-badges';
import { Tile, TileValue } from '../../components/roster/tile';
import { useTemplateDownload } from '../../components/roster/use-template-download';
import { signInRedirect } from '../../components/sign-in-redirect';
import { getCommission } from '../../server/commissions';
import type {
  Commission,
  DirectoryResult,
  RosterImport,
  RosterSummary,
} from '../../server/directory/client';
import { getRosterApiCredential } from '../../server/roster-api-credential';
import { getRosterImport } from '../../server/roster-imports';

interface OverviewData {
  commission: DirectoryResult<Commission>;
  /** The latest completed import, for the Last import card; null when there is none. */
  lastImport: DirectoryResult<RosterImport> | null;
  /** For the reporting officer's "Connect your HR system" step; null when unknown. */
  credential: CredentialState | null;
}

export const Route = createFileRoute('/roster/')({
  loader: async ({ location, context }): Promise<OverviewData | null> => {
    // The layout shows no overview without the workspace; do not fetch one.
    if (!context.workspace) return null;
    // Roster screens are about the viewer's own Commission, the tenant of their session.
    const slug = context.tenant;
    if (!slug) return { commission: noCommission, lastImport: null, credential: null };
    const [commission, credential] = await Promise.all([
      getCommission({ data: { slug } }),
      // Credentials are the reporting officer's alone; the directory refuses anyone else.
      context.workspace.readOnly ? null : getRosterApiCredential({ data: { slug } }),
    ]);
    if (!commission.ok && commission.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    const lastImportId = commission.ok ? commission.data.roster.lastImportId : null;
    const lastImport = lastImportId
      ? await getRosterImport({ data: { slug, importId: lastImportId } })
      : null;
    return {
      commission,
      lastImport,
      credential: credential?.ok ? credentialState(credential.data) : null,
    };
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: OverviewSkeleton,
  component: RosterOverview,
});

/** A roster-workspace role without a tenant: a broken account, shown as a failed load. */
const noCommission: DirectoryResult<Commission> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

function RosterOverview() {
  const data = Route.useLoaderData();
  const { workspace } = Route.useRouteContext();
  if (!data || !workspace) return null;
  const readOnly = workspace.readOnly;
  const result = data.commission;

  if (!result.ok) {
    return (
      <Page narrow>
        <OverviewHead readOnly={readOnly} />
        <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
      </Page>
    );
  }
  const commission = result.data;
  const { roster } = commission;
  if (roster.status === 'none') {
    return (
      <Page>
        <OverviewHead commissionName={commission.name} readOnly={readOnly} />
        <NoRoster readOnly={readOnly} />
      </Page>
    );
  }
  return (
    <Page>
      <OverviewHead
        commissionName={commission.name}
        readOnly={readOnly}
        actions={
          <>
            <TemplateMenu />
            {readOnly ? null : <ImportButton />}
          </>
        }
      />
      <SummaryTiles roster={roster} />
      <nav aria-label={m.links} className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link to="/roster/records">
            <Icon icon={LeftToRightListBulletIcon} />
            {m.records}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link to="/roster/flagged">
            <Icon icon={Flag02Icon} />
            {m.flaggedTitlePage}
          </Link>
        </Button>
        {readOnly ? null : (
          <Button asChild variant="secondary" size="sm">
            <Link to="/roster/api-access">
              <Icon icon={Key01Icon} />
              {m.apiTitle}
            </Link>
          </Button>
        )}
      </nav>
      <div className="mt-5 grid items-start gap-5 min-[1000px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <LastImportCard result={data.lastImport} />
        <NextStepsCard
          steps={nextSteps({ flagged: roster.flagged, readOnly, credential: data.credential })}
        />
      </div>
    </Page>
  );
}

function OverviewHead({
  commissionName,
  readOnly,
  actions,
}: {
  commissionName?: string;
  readOnly: boolean;
  actions?: ReactNode;
}) {
  return (
    <PageHead title={m.title} actions={actions}>
      {commissionName || readOnly ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {commissionName ? (
            <p className="text-sm text-muted-foreground">{commissionName}</p>
          ) : null}
          {readOnly ? <ReadOnlyBadge /> : null}
        </div>
      ) : null}
    </PageHead>
  );
}

/** The no-roster state (the prototype's `.empty` in a card, larger than a list's EmptyState). */
function NoRoster({ readOnly }: { readOnly: boolean }) {
  return (
    <Card className="p-0 sm:p-0">
      <div className="flex flex-col items-center px-5 pt-12 pb-10 text-center">
        <div
          aria-hidden="true"
          className="mb-4 flex size-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-subtle-foreground [&_svg]:size-5"
        >
          <Icon icon={UserGroupIcon} />
        </div>
        <h2 className="text-lg leading-snug font-semibold">{m.noneTitle}</h2>
        <p className="mt-1.5 max-w-[520px] text-[14.5px] leading-relaxed text-pretty text-muted-foreground">
          {readOnly ? m.noneTextReadOnly : m.noneText}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <TemplateMenu />
          {readOnly ? null : <ImportButton />}
        </div>
      </div>
    </Card>
  );
}

/** "Download template" with a menu of the two formats; saves the file or says it could not. */
function TemplateMenu() {
  const download = useTemplateDownload('/roster');
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary">
          <Icon icon={Download04Icon} />
          {m.downloadTemplate}
          <Icon icon={ArrowDown01Icon} className="-mr-0.5 size-[15px]" />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => void download('csv')}>
          <Icon icon={File02Icon} />
          {m.templateCsv}
        </MenuItem>
        <MenuItem onSelect={() => void download('xlsx')}>
          <Icon icon={Xls02Icon} />
          {m.templateXlsx}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** The way into the import wizard. */
function ImportButton() {
  return (
    <Button asChild>
      <Link to="/roster/import">
        <Icon icon={Upload04Icon} />
        {m.importRoster}
      </Link>
    </Button>
  );
}

function SummaryTiles({ roster }: { roster: RosterSummary }) {
  const percent = onboardedPercent(roster.onboardedDeclarants, roster.expectedDeclarants);
  const flagged = roster.flagged > 0;
  return (
    <section aria-label={m.summaryCards} className="grid gap-3.5 min-[760px]:grid-cols-3">
      <Tile icon={UserGroupIcon} label={m.expectedDeclarants}>
        <TileValue>{formatNumber(roster.expectedDeclarants)}</TileValue>
      </Tile>
      <Tile icon={UserCheck01Icon} label={m.onboarded}>
        <TileValue>
          {formatNumber(roster.onboardedDeclarants)}{' '}
          <small className="text-sm font-medium tracking-normal text-muted-foreground">
            {m.onboardedShare(percent)}
          </small>
        </TileValue>
        <ProgressBar
          label={m.onboarded}
          value={percent}
          size="sm"
          tone="success"
          showValue={false}
          className="mt-1"
        />
        <p className="text-[13px] text-muted-foreground">{m.toGo(toOnboard(roster))}</p>
      </Tile>
      <Tile
        icon={Flag02Icon}
        label={m.flagged}
        className={
          flagged
            ? 'bg-linear-to-b from-warning-subtle/45 to-card ring-1 ring-warning/25'
            : undefined
        }
      >
        <div className="flex items-center justify-between gap-2">
          <TileValue>{formatNumber(roster.flagged)}</TileValue>
          {flagged ? (
            <Link
              to="/roster/flagged"
              aria-label={m.reviewFlagged}
              className="inline-flex items-center gap-0.5 rounded-sm text-[13.5px] font-medium underline-offset-[3px] outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-3.5"
            >
              {m.review}
              <Icon icon={ArrowRight01Icon} />
            </Link>
          ) : null}
        </div>
      </Tile>
    </section>
  );
}

/** A card of the overview's lower row, with a hairline under its heading. */
function OverviewCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card role="region" aria-labelledby={id} className="gap-0 overflow-hidden p-0 sm:p-0">
      <h2 id={id} className="border-b px-5 py-4 text-base font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** The latest completed import: how it came in, when and by whom, and what it did. */
function LastImportCard({ result }: { result: DirectoryResult<RosterImport> | null }) {
  if (!result) return null;
  return (
    <OverviewCard id="last-import-title" title={m.lastImport}>
      <div className="grid gap-3 p-5">
        {result.ok ? (
          <LastImport item={result.data} />
        ) : (
          <p className="text-sm text-muted-foreground">{m.lastImportError}</p>
        )}
      </div>
    </OverviewCard>
  );
}

function LastImport({ item }: { item: RosterImport }) {
  const { counts } = item;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ImportChannelBadge channel={item.channel} />
        <Badge>{item.declaredComplete ? m.completeRoster : m.partialUpdate}</Badge>
        <ImportStateBadge state={item.state} />
      </div>
      <div className="min-w-0">
        <p className="text-[15.5px] font-semibold break-words">
          {item.channel === 'api' ? m.lastImportApi : m.lastImportFile(item.fileName)}
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground" suppressHydrationWarning>
          {m.lastImportWhen(
            formatDateTime(item.startedAt),
            formatRelativeTime(item.startedAt),
            item.startedBy.name,
          )}
        </p>
      </div>
      {counts ? (
        <p className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-sm text-secondary-foreground">
          <Count value={counts.created} label={m.countCreated} />
          <Count value={counts.updated} label={m.countUpdated} />
          <Count value={counts.unchanged} label={m.countUnchanged} />
          <Count value={counts.rejected} label={m.countRejected} />
          <Count value={counts.flaggedAbsent} label={m.countFlagged} />
        </p>
      ) : null}
    </>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <b className="font-semibold text-foreground tabular-nums">{formatNumber(value)}</b> {label}
    </span>
  );
}

const STEP_ICONS: Record<NextStep['kind'], IconProps['icon']> = {
  'review-flagged': Flag02Icon,
  'connect-hr': Key01Icon,
  'find-someone': Search01Icon,
};

/** What to do next, each a link to the page where it is done. */
function NextStepsCard({ steps }: { steps: NextStep[] }) {
  return (
    <OverviewCard id="next-steps-title" title={m.nextSteps}>
      <ul className="divide-y">
        {steps.map((step) => (
          <li key={step.kind}>
            <StepLink step={step} />
          </li>
        ))}
      </ul>
    </OverviewCard>
  );
}

const STEP_LINK =
  'flex items-center gap-3 px-5 py-3.5 text-sm font-medium outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

function StepBody({ step, label }: { step: NextStep; label: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-muted text-secondary-foreground [&_svg]:size-[17px]"
      >
        <Icon icon={STEP_ICONS[step.kind]} />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <Icon icon={ArrowRight01Icon} className="size-[17px] text-muted-foreground" />
    </>
  );
}

function StepLink({ step }: { step: NextStep }) {
  if (step.kind === 'review-flagged') {
    return (
      <Link to="/roster/flagged" className={STEP_LINK}>
        <StepBody step={step} label={m.nextReviewFlagged(step.count)} />
      </Link>
    );
  }
  if (step.kind === 'connect-hr') {
    return (
      <Link to="/roster/api-access" className={STEP_LINK}>
        <StepBody step={step} label={m.nextConnectHr} />
      </Link>
    );
  }
  return (
    <Link to="/roster/records" className={STEP_LINK}>
      <StepBody step={step} label={m.nextFindSomeone} />
    </Link>
  );
}

function OverviewSkeleton() {
  return (
    <Page>
      <PageHead title={m.title}>
        <Skeleton className="mt-2 h-4 w-[180px]" />
      </PageHead>
      <Card className="p-0 sm:p-0">
        <div className="flex flex-col items-center gap-3 px-5 pt-12 pb-10" aria-label={m.loading}>
          <Skeleton className="size-11 rounded-xl" />
          <Skeleton className="h-5 w-[140px]" />
          <Skeleton className="h-4 w-full max-w-[420px]" />
          <Skeleton className="h-10 w-[200px]" />
        </div>
      </Card>
    </Page>
  );
}
