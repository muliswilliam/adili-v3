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
  Tooltip,
  useToast,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  Download04Icon,
  File02Icon,
  Flag02Icon,
  Upload04Icon,
  UserCheck01Icon,
  UserGroupIcon,
  Xls02Icon,
} from '@hugeicons/core-free-icons';
import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ReadOnlyBadge } from '../../components/commissions/badges';
import { formatNumber } from '../../components/format';
import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { messages as m } from '../../components/roster/messages';
import {
  downloadRosterTemplate,
  type RosterTemplateFormat,
} from '../../components/roster/template-download';
import { signInRedirect } from '../../components/sign-in-redirect';
import { getCommission } from '../../server/commissions';
import type { Commission, DirectoryResult } from '../../server/directory/client';

type RosterSummary = Commission['roster'];

export const Route = createFileRoute('/roster/')({
  loader: async ({ location, context }) => {
    // The layout shows no overview without the workspace; do not fetch one.
    if (!context.workspace) return null;
    // Roster screens are about the viewer's own Commission, the tenant of their session.
    if (!context.tenant) return noCommission;
    const result = await getCommission({ data: { slug: context.tenant } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
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
  const result = Route.useLoaderData();
  const { workspace } = Route.useRouteContext();
  if (!result || !workspace) return null;
  const readOnly = workspace.readOnly;

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
  const { toast } = useToast();
  const download = async (format: RosterTemplateFormat) => {
    const outcome = await downloadRosterTemplate(format);
    if (outcome === 'unauthenticated') {
      window.location.assign(`/auth/login?returnTo=${encodeURIComponent('/roster')}`);
    } else if (outcome === 'failed') {
      toast({ title: m.templateError, urgency: 'assertive' });
    }
  };
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

/**
 * The way into the import wizard, which is not built yet: disabled, with the reason on hover and
 * focus (a disabled button takes neither, so the tooltip sits on a focusable wrapper).
 */
function ImportButton() {
  return (
    <Tooltip content={m.importNotYet}>
      <span
        tabIndex={0}
        className="inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Button disabled aria-disabled="true" tabIndex={-1}>
          <Icon icon={Upload04Icon} />
          {m.importRoster}
        </Button>
      </span>
    </Tooltip>
  );
}

function SummaryTiles({ roster }: { roster: RosterSummary }) {
  const onboardedPercent =
    roster.expectedDeclarants > 0
      ? Math.round((roster.onboardedDeclarants / roster.expectedDeclarants) * 100)
      : 0;
  return (
    <section aria-label={m.summaryCards} className="grid gap-3.5 min-[760px]:grid-cols-3">
      <Tile icon={UserGroupIcon} label={m.expectedDeclarants}>
        <TileValue>{formatNumber(roster.expectedDeclarants)}</TileValue>
      </Tile>
      <Tile icon={UserCheck01Icon} label={m.onboarded}>
        <TileValue>
          {formatNumber(roster.onboardedDeclarants)}{' '}
          <small className="text-sm font-medium text-muted-foreground">
            {m.onboardedShare(onboardedPercent)}
          </small>
        </TileValue>
        <ProgressBar
          label={m.onboarded}
          value={onboardedPercent}
          size="sm"
          tone="success"
          showValue={false}
          className="mt-1"
        />
        <p className="text-[13px] text-muted-foreground">
          {m.toGo(Math.max(roster.expectedDeclarants - roster.onboardedDeclarants, 0))}
        </p>
      </Tile>
      <Tile icon={Flag02Icon} label={m.flagged}>
        <TileValue>{formatNumber(roster.flagged)}</TileValue>
        {roster.flagged > 0 ? <Badge variant="warning">{m.flagged}</Badge> : null}
      </Tile>
    </section>
  );
}

function Tile({
  icon,
  label,
  children,
}: {
  icon: IconProps['icon'];
  label: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-1.5">
      <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-muted-foreground [&_svg]:size-[15px]">
        <Icon icon={icon} />
        {label}
      </p>
      {children}
    </Card>
  );
}

function TileValue({ children }: { children: ReactNode }) {
  return (
    <p className="text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
      {children}
    </p>
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
