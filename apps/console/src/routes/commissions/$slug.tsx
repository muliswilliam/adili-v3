import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  EmptyState,
  Icon,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  FileSpreadsheetIcon,
  SearchRemoveIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';

import { CommissionTypeBadge } from '../../components/commissions/commissions-table';
import { formatDateTime } from '../../components/commissions/format';
import { messages } from '../../components/commissions/messages';
import { loginRedirect } from '../../components/login-redirect';
import { getCommission } from '../../server/commissions';
import type { Commission } from '../../server/directory/types';

export const Route = createFileRoute('/commissions/$slug')({
  loader: async ({ params, context, location }) => {
    if (!context.access) return null;
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
  notFoundComponent: CommissionNotFound,
  component: CommissionDetail,
});

function BackLink() {
  return (
    <Button asChild variant="link" className="w-fit text-muted-foreground">
      <Link to="/commissions">
        <Icon icon={ArrowLeft01Icon} />
        {messages.allCommissions}
      </Link>
    </Button>
  );
}

function CommissionDetail() {
  const result = Route.useLoaderData();
  const router = useRouter();
  if (!result) return null;

  if (!result.ok) {
    const forbidden = result.failure.kind === 'forbidden';
    return (
      <div className="grid gap-6">
        <BackLink />
        <Alert variant={forbidden ? 'warning' : 'destructive'}>
          <Icon icon={AlertCircleIcon} />
          {forbidden ? (
            <AlertDescription>{messages.forbidden}</AlertDescription>
          ) : (
            <>
              <AlertTitle>{messages.detail.loadError}</AlertTitle>
              <AlertDescription className="grid justify-items-start gap-3">
                <p>{messages.error.detailFallback}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void router.invalidate();
                  }}
                >
                  {messages.error.retry}
                </Button>
              </AlertDescription>
            </>
          )}
        </Alert>
      </div>
    );
  }

  const commission = result.data;
  return (
    <div className="grid gap-6">
      <BackLink />
      <div className="grid gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{commission.name}</h1>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-muted-foreground uppercase">
            {commission.issuerCode}
          </span>
          <CommissionTypeBadge type={commission.type} />
        </div>
      </div>
      {/* The reporting officer card joins this grid with #18. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <DetailsCard commission={commission} />
        <RosterCard />
      </div>
    </div>
  );
}

function DetailsCard({ commission }: { commission: Commission }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.detail.details}</CardTitle>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term={messages.detail.name}>{commission.name}</DescriptionItem>
          <DescriptionItem term={messages.detail.key}>
            <span className="font-mono">{commission.slug}</span>
          </DescriptionItem>
          <DescriptionItem term={messages.detail.issuerCode}>
            <span className="font-mono">{commission.issuerCode}</span>
          </DescriptionItem>
          <DescriptionItem term={messages.detail.type}>
            {messages.type[commission.type]}
          </DescriptionItem>
          <DescriptionItem term={messages.detail.categories}>
            {commission.categories.length > 0 ? (
              <ul className="grid gap-2 font-normal">
                {commission.categories.map((category) => (
                  <li key={category.code} className="grid">
                    <span className="font-mono text-[13px] font-medium">{category.citation}</span>
                    <span className="text-muted-foreground">{category.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">{messages.categoriesNone}</span>
            )}
          </DescriptionItem>
          <DescriptionItem term={messages.detail.policyVersion}>
            {messages.detail.policyVersionValue(commission.policyVersion)}
          </DescriptionItem>
          <DescriptionItem term={messages.detail.created}>
            <time dateTime={commission.createdAt}>{formatDateTime(commission.createdAt)}</time>
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/** Slice 01 has no roster yet; slice 02 replaces this card. */
function RosterCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.detail.roster}</CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState
          icon={<Icon icon={FileSpreadsheetIcon} />}
          title={messages.detail.rosterEmptyTitle}
          text={messages.detail.rosterEmptyText}
          className="border-0 py-6"
        />
      </CardContent>
    </Card>
  );
}

function CommissionNotFound() {
  return (
    <div className="grid gap-6">
      <BackLink />
      <EmptyState
        icon={<Icon icon={SearchRemoveIcon} />}
        title={messages.detail.notFoundTitle}
        text={messages.detail.notFoundText}
      />
    </div>
  );
}
