import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  EmptyState,
  Skeleton,
} from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Search, UserPlus, Users } from 'lucide-react';

import {
  CommissionTypeBadge,
  IssuerCode,
  OfficerStateBadge,
} from '../../components/commissions/badges';
import { CommissionsBreadcrumb } from '../../components/commissions/breadcrumb';
import { messages as m } from '../../components/commissions/messages';
import { formatDate, formatDateTime } from '../../components/format';
import { LoadError } from '../../components/load-error';
import { signInRedirect } from '../../components/sign-in-redirect';
import { getCommission } from '../../server/commissions';
import type { Commission, ReportingOfficer } from '../../server/directory/client';

export const Route = createFileRoute('/commissions/$slug')({
  loader: async ({ params, location }) => {
    const result = await getCommission({ data: { slug: params.slug } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.ok ? loaderData.data.name : m.title} · Adili Online Console`,
      },
    ],
  }),
  pendingComponent: DetailSkeleton,
  component: CommissionDetail,
});

function CommissionDetail() {
  const result = Route.useLoaderData();
  if (result.ok) {
    return <Detail commission={result.data} />;
  }
  const { error } = result;
  if (error.kind === 'problem' && (error.problem.status === 404 || error.problem.status === 403)) {
    return (
      <div className="grid gap-6">
        <CommissionsBreadcrumb current={m.notFoundTitle} />
        <Card>
          <EmptyState
            icon={<Search />}
            title={m.notFoundTitle}
            text={m.notFoundText}
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/commissions">{m.backToCommissions}</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <CommissionsBreadcrumb current={m.detailErrorTitle} />
      <LoadError
        title={m.detailErrorTitle}
        detail={(error.kind === 'unavailable' ? error.detail : null) ?? m.errorDetail}
        retryLabel={m.tryAgain}
      />
    </div>
  );
}

function Detail({ commission }: { commission: Commission }) {
  return (
    <div className="grid gap-6">
      <CommissionsBreadcrumb current={commission.name} />
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{commission.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <IssuerCode
            code={commission.issuerCode}
            className="rounded-md bg-muted px-2 py-0.5 text-foreground"
          />
          <CommissionTypeBadge type={commission.type} />
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <DetailsCard commission={commission} />
        <OfficerCard officer={commission.reportingOfficer} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{m.rosterCardTitle}</CardTitle>
        </CardHeader>
        <EmptyState
          icon={<Users />}
          title={m.rosterNoneTitle}
          text={m.rosterNoneText}
          className="pt-2"
        />
      </Card>
    </div>
  );
}

function DetailsCard({ commission }: { commission: Commission }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.details}</CardTitle>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term={m.name}>{commission.name}</DescriptionItem>
          <DescriptionItem term={m.commissionKey}>
            <span className="font-mono">{commission.slug}</span>
          </DescriptionItem>
          <DescriptionItem term={m.issuerCode}>
            <span className="font-mono">{commission.issuerCode}</span>
          </DescriptionItem>
          <DescriptionItem term={m.typeLabel}>
            {commission.type === 'federated' ? m.typeFederatedLong : m.typeHostedLong}
          </DescriptionItem>
          <DescriptionItem term={m.categories}>
            {commission.categories.length > 0 ? (
              <ul className="grid gap-2">
                {commission.categories.map((category) => (
                  <li key={category.code} className="grid gap-x-3 sm:grid-cols-[7rem_1fr]">
                    <span className="font-mono text-xs leading-5 whitespace-nowrap">
                      {category.citation}
                    </span>
                    <span className="font-normal">{category.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="font-normal text-muted-foreground">{m.noCategories}</span>
            )}
          </DescriptionItem>
          <DescriptionItem term={m.policyVersion}>
            {m.policyVersionValue(commission.policyVersion)}
          </DescriptionItem>
          <DescriptionItem term={m.created}>
            <time dateTime={commission.createdAt}>{formatDateTime(commission.createdAt)}</time>
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

function OfficerCard({ officer }: { officer: ReportingOfficer | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.officerCardTitle}</CardTitle>
      </CardHeader>
      {officer ? (
        <CardContent className="grid gap-4">
          <DescriptionList>
            <DescriptionItem term={m.officerName}>{officer.name}</DescriptionItem>
            <DescriptionItem term={m.officerEmail}>{officer.email}</DescriptionItem>
            <DescriptionItem term={m.officerPhone}>
              <span className="tabular-nums">{officer.phone}</span>
            </DescriptionItem>
            <DescriptionItem term={m.officerState}>
              <OfficerStateBadge state={officer.state} />
            </DescriptionItem>
            {officer.state === 'activated' && officer.activatedAt ? (
              <DescriptionItem term={m.officerActivatedOn}>
                <time dateTime={officer.activatedAt}>{formatDate(officer.activatedAt)}</time>
              </DescriptionItem>
            ) : (
              <DescriptionItem term={m.officerInvitedOn}>
                <time dateTime={officer.invitedAt}>{formatDate(officer.invitedAt)}</time>
              </DescriptionItem>
            )}
          </DescriptionList>
          {officer.state === 'invited' ? (
            <p className="text-sm text-muted-foreground">{m.officerLinkValidity}</p>
          ) : null}
        </CardContent>
      ) : (
        <EmptyState
          icon={<UserPlus />}
          title={m.officerNoneTitle}
          text={m.officerNoneText}
          className="pt-2"
        />
      )}
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label={m.title}>
      <Skeleton className="h-4 w-48" />
      <div className="grid gap-2">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {[7, 5].map((rows) => (
          <Card key={rows}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="grid gap-4">
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="grid gap-4 sm:grid-cols-3">
                  <Skeleton className="w-20" />
                  <Skeleton className="w-40 sm:col-span-2" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
