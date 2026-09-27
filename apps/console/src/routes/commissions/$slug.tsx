import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  Dialog,
  DialogTrigger,
  EmptyState,
  Skeleton,
  useToast,
} from '@adili/ui';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { ArrowRightLeft, Clock, LoaderCircle, Search, Send, UserPlus, Users } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  CommissionTypeBadge,
  IssuerCode,
  OfficerStateBadge,
} from '../../components/commissions/badges';
import { AssignDialogContent } from '../../components/commissions/assign-dialog';
import { CommissionsBreadcrumb } from '../../components/commissions/breadcrumb';
import { messages as m } from '../../components/commissions/messages';
import { formatPhone } from '../../components/commissions/phone';
import { resendOutcome } from '../../components/commissions/resend';
import { formatDate, formatDateTime } from '../../components/format';
import { LoadError } from '../../components/load-error';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor } from '../../components/workspaces';
import { getCommission, resendInvitation } from '../../server/commissions';
import type { Commission } from '../../server/directory/client';

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
        <OfficerCard commission={commission} />
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

function OfficerCard({ commission }: { commission: Commission }) {
  const { viewer } = Route.useRouteContext();
  const router = useRouter();
  const { toast } = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const justAssigned = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // A fresh dialog (draft and Idempotency-Key) each time it opens: cancelling discards both.
  const [dialogSession, setDialogSession] = useState(0);
  const [resending, setResending] = useState(false);
  const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
  const canWrite = workspaceFor(roles, 'commissions')?.readOnly === false;
  const officer = commission.reportingOfficer;

  const openChange = (open: boolean) => {
    if (open) setDialogSession((session) => session + 1);
    setDialogOpen(open);
  };

  const assigned = (updated: Commission) => {
    // A first assignment removes its trigger (the empty state), so focus goes to the heading.
    justAssigned.current = officer === null;
    setDialogOpen(false);
    toast({ title: m.invitationSentToast(updated.reportingOfficer?.email ?? '') });
    // Refetch so the card shows the directory's view of the new assignment.
    void router.invalidate();
  };

  const resend = async () => {
    if (!officer || resending) return;
    setResending(true);
    const result = await resendInvitation({ data: { slug: commission.slug } }).catch(() => ({
      ok: false as const,
      error: { kind: 'unavailable' as const, detail: null },
    }));
    setResending(false);
    if (!result.ok && result.error.kind === 'unauthenticated') {
      window.location.assign(
        `/auth/login?returnTo=${encodeURIComponent(`/commissions/${commission.slug}`)}`,
      );
      return;
    }
    const outcome = resendOutcome(result.ok ? null : result.error, officer.email);
    toast({ title: outcome.title, variant: outcome.destructive ? 'destructive' : undefined });
    if (outcome.refetch) void router.invalidate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
          {m.officerCardTitle}
        </CardTitle>
      </CardHeader>
      <Dialog open={dialogOpen} onOpenChange={openChange}>
        {officer ? (
          <>
            <CardContent className="grid gap-4">
              <DescriptionList>
                <DescriptionItem term={m.officerName}>{officer.name}</DescriptionItem>
                <DescriptionItem term={m.officerEmail}>
                  <span className="break-all">{officer.email}</span>
                </DescriptionItem>
                <DescriptionItem term={m.officerPhone}>
                  <span className="tabular-nums">{formatPhone(officer.phone)}</span>
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
                <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
                  <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{m.officerLinkValidity}</span>
                </p>
              ) : null}
            </CardContent>
            {canWrite ? (
              <CardFooter className="flex-wrap justify-end gap-2">
                {officer.state === 'invited' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resending}
                    aria-busy={resending || undefined}
                    onClick={() => void resend()}
                  >
                    {resending ? (
                      <>
                        <LoaderCircle aria-hidden="true" className="animate-spin" />
                        {m.officerResending}
                      </>
                    ) : (
                      <>
                        <Send aria-hidden="true" />
                        {m.officerResend}
                      </>
                    )}
                  </Button>
                ) : null}
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={resending}>
                    <ArrowRightLeft aria-hidden="true" />
                    {m.officerReplace}
                  </Button>
                </DialogTrigger>
              </CardFooter>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={<UserPlus />}
            title={m.officerNoneTitle}
            text={m.officerNoneText}
            className="pt-2"
            action={
              canWrite ? (
                <DialogTrigger asChild>
                  <Button size="sm">
                    <UserPlus aria-hidden="true" />
                    {m.assignOfficer}
                  </Button>
                </DialogTrigger>
              ) : undefined
            }
          />
        )}
        <AssignDialogContent
          key={dialogSession}
          commission={commission}
          mode={officer ? 'replace' : 'assign'}
          onAssigned={assigned}
          onCloseAutoFocus={(event) => {
            // The trigger goes away once the card shows the officer; land on the heading.
            if (justAssigned.current) {
              justAssigned.current = false;
              event.preventDefault();
              headingRef.current?.focus();
            }
          }}
        />
      </Dialog>
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
