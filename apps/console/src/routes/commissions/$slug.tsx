import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Icon, Skeleton } from '@adili/ui';
import {
  AlertCircleIcon,
  Building03Icon,
  RefreshIcon,
  Search01Icon,
  SquareLock02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { CommissionTypeBadge, ReadOnlyBadge } from '../../components/commissions/badges';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  onboardedPercent,
} from '../../components/commissions/format';
import { messages } from '../../components/commissions/messages';
import { loginRedirect } from '../../components/login-redirect';
import { Page, PageHead, SectionCard } from '../../components/page';
import { getCommission } from '../../server/commissions';
import type { DirectoryResult } from '../../server/directory/result';
import type { Commission } from '../../server/directory/types';

export const Route = createFileRoute('/commissions/$slug')({
  loader: async ({ params, context, location }) => {
    // Staff outside the workspace see a Commission as if it did not exist, as the directory
    // answers for other tenants.
    if (!context.access) throw notFound();
    const result = await getCommission({ data: { slug: params.slug } });
    if (!result.ok && result.failure.kind === 'unauthenticated') {
      throw loginRedirect(location.href);
    }
    if (!result.ok && result.failure.kind === 'not-found') throw notFound();
    return result;
  },
  head: ({ loaderData }) => ({
    meta: loaderData?.ok ? [{ title: `${loaderData.data.name} · Adili Online Console` }] : [],
  }),
  staticData: {
    crumb: ({ status, loaderData }) => {
      if (status === 'notFound') return messages.detail.notFoundCrumb;
      const result = loaderData as DirectoryResult<Commission> | undefined;
      if (!result) return messages.detail.loading;
      return result.ok ? result.data.name : messages.detail.loadError;
    },
  },
  pendingComponent: CommissionDetailPending,
  notFoundComponent: CommissionNotFound,
  component: CommissionDetail,
});

function CommissionDetail() {
  const result = Route.useLoaderData();
  const { access } = Route.useRouteContext();
  const router = useRouter();

  if (!result.ok) {
    const forbidden = result.failure.kind === 'forbidden';
    return (
      <Page narrow>
        {forbidden ? (
          <Alert role="status">
            <Icon icon={SquareLock02Icon} />
            <AlertTitle>{messages.forbidden}</AlertTitle>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>{messages.detail.loadError}</AlertTitle>
            <AlertDescription className="grid justify-items-start gap-2.5">
              <p>{messages.error.text}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void router.invalidate();
                }}
              >
                <Icon icon={RefreshIcon} />
                {messages.error.retry}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </Page>
    );
  }

  const commission = result.data;
  return (
    <Page>
      <PageHead title={commission.name}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-sm bg-muted px-2 py-[3px] font-mono text-[12.5px] font-medium tracking-[0.04em] text-secondary-foreground">
            {commission.issuerCode}
          </span>
          <CommissionTypeBadge type={commission.type} />
          {access === 'read' ? <ReadOnlyBadge /> : null}
        </div>
      </PageHead>
      {/* The right-hand column holds the reporting officer card (#18). */}
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <DetailsCard commission={commission} />
        <RosterCard roster={commission.roster} className="min-[980px]:col-span-2" />
      </div>
    </Page>
  );
}

function DetailRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b py-[11px] text-[14.5px] last:border-b-0 min-[600px]:grid-cols-[170px_minmax(0,1fr)] min-[600px]:gap-4">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

function DetailsCard({ commission }: { commission: Commission }) {
  return (
    <SectionCard id="details" icon={Building03Icon} title={messages.detail.details}>
      <dl className="px-5 py-1.5">
        <DetailRow term={messages.detail.key}>
          <span className="font-mono">{commission.slug}</span>
        </DetailRow>
        <DetailRow term={messages.detail.issuerCode}>
          <span
            className="font-mono"
            title={messages.detail.issuerCodeExample(commission.issuerCode)}
          >
            {commission.issuerCode}
          </span>
        </DetailRow>
        <DetailRow term={messages.detail.type}>{messages.typeLong[commission.type]}</DetailRow>
        <DetailRow term={messages.detail.categories}>
          {commission.categories.length > 0 ? (
            <ul className="grid gap-2">
              {commission.categories.map((category) => (
                <li
                  key={category.code}
                  className="grid grid-cols-[96px_minmax(0,1fr)] gap-2.5 text-sm leading-[1.4] font-normal"
                >
                  <span className="text-[13px] font-medium text-secondary-foreground tabular-nums">
                    {category.citation}
                  </span>
                  <span>{category.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="font-normal text-muted-foreground">{messages.categoriesNone}</span>
          )}
        </DetailRow>
        <DetailRow term={messages.detail.policyVersion}>
          {messages.detail.policyVersionValue(commission.policyVersion)}
        </DetailRow>
        <DetailRow term={messages.detail.created}>
          <time dateTime={commission.createdAt}>{formatDateTime(commission.createdAt)}</time>
        </DetailRow>
      </dl>
    </SectionCard>
  );
}

function Count({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <dt className="text-[12.5px] font-medium text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** The roster summary from the Commission record; imports and records arrive with slice 02. */
function RosterCard({ roster, className }: { roster: Commission['roster']; className?: string }) {
  return (
    <SectionCard
      id="roster"
      icon={UserGroupIcon}
      title={messages.detail.roster}
      className={className}
    >
      {roster.status === 'none' || !roster.lastImportAt ? (
        <EmptyState
          icon={<Icon icon={UserGroupIcon} />}
          title={messages.detail.rosterEmptyTitle}
          text={messages.detail.rosterEmptyText}
        />
      ) : (
        <dl className="grid grid-cols-2 gap-2.5 px-5 py-[18px] min-[600px]:grid-cols-4">
          <Count term={messages.detail.expected}>{formatNumber(roster.expectedDeclarants)}</Count>
          <Count term={messages.detail.onboarded}>
            {formatNumber(roster.onboardedDeclarants)}{' '}
            <small className="text-[13px] font-medium tracking-normal text-muted-foreground">
              {onboardedPercent(roster.onboardedDeclarants, roster.expectedDeclarants)}%
            </small>
          </Count>
          <Count term={messages.detail.flagged}>{formatNumber(roster.flagged)}</Count>
          <Count term={messages.detail.lastImport}>
            <time
              dateTime={roster.lastImportAt}
              title={formatDateTime(roster.lastImportAt)}
              className="mt-1.5 block text-base"
            >
              {formatDate(roster.lastImportAt)}
            </time>
          </Count>
        </dl>
      )}
    </SectionCard>
  );
}

function CommissionDetailPending() {
  return (
    <Page aria-busy="true">
      <div className="mb-[22px]">
        <Skeleton className="h-6 w-[320px] max-w-[80%]" />
        <Skeleton className="mt-3 w-[140px]" />
      </div>
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid gap-3.5 rounded-2xl bg-card p-5 shadow-card">
          {Array.from({ length: 6 }, (_, line) => (
            <Skeleton key={line} />
          ))}
        </div>
        <div className="grid gap-3.5 rounded-2xl bg-card p-5 shadow-card">
          {Array.from({ length: 4 }, (_, line) => (
            <Skeleton key={line} className="w-[70%]" />
          ))}
        </div>
      </div>
    </Page>
  );
}

function CommissionNotFound() {
  const { access } = Route.useRouteContext();
  return (
    <Page narrow>
      <div className="rounded-2xl bg-card p-2 shadow-card">
        <EmptyState
          icon={<Icon icon={Search01Icon} />}
          title={messages.detail.notFoundTitle}
          text={messages.detail.notFoundText}
          action={
            access ? (
              <Button asChild variant="secondary" size="sm">
                <Link to="/commissions">{messages.detail.back}</Link>
              </Button>
            ) : null
          }
        />
      </div>
    </Page>
  );
}
