import { Badge, Button, Dialog, DialogTrigger, EmptyState, Icon, useToast } from '@adili/ui';
import {
  ArrowDataTransferHorizontalIcon,
  Building03Icon,
  Clock01Icon,
  Loading03Icon,
  SentIcon,
  UserAdd01Icon,
  UserSquareIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { AssignDialogContent } from '../../../components/commissions/assign-dialog';
import {
  CommissionTypeBadge,
  OfficerStateBadge,
  ReadOnlyBadge,
} from '../../../components/commissions/badges';
import { messages as m } from '../../../components/commissions/messages';
import { formatPhone } from '../../../components/commissions/phone';
import { resendOutcome } from '../../../components/commissions/resend';
import { RECENT_IMPORTS, RosterCard } from '../../../components/commissions/roster-card';
import { formatDate, formatDateTime, formatRelativeDate } from '../../../components/format';
import { DetailItem, DetailList, Page, PageHead, SectionCard } from '../../../components/page';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import { resendInvitation } from '../../../server/commissions';
import type { Commission } from '../../../server/directory/client';
import { listRecentRosterImports } from '../../../server/roster-records';

export const Route = createFileRoute('/commissions/$slug/')({
  loader: async ({ params, location, context }) => {
    // The layout shows no Commission without the workspace; do not fetch its imports.
    if (!context.workspace) return null;
    const imports = await listRecentRosterImports({
      data: { slug: params.slug, limit: RECENT_IMPORTS },
    });
    if (!imports.ok && imports.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return imports;
  },
  component: CommissionDetail,
});

const commissionRoute = getRouteApi('/commissions/$slug');

function CommissionDetail() {
  const result = commissionRoute.useLoaderData();
  // The layout shows the Commission's failed load or absence.
  if (!result?.ok) return null;
  return <Detail commission={result.data} />;
}

function Detail({ commission }: { commission: Commission }) {
  const { workspace } = Route.useRouteContext();
  const imports = Route.useLoaderData();
  return (
    <Page>
      <PageHead title={commission.name}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge className="rounded-sm font-mono tracking-[0.04em]">{commission.issuerCode}</Badge>
          <CommissionTypeBadge type={commission.type} />
          {workspace?.readOnly ? <ReadOnlyBadge /> : null}
        </div>
      </PageHead>
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <DetailsCard commission={commission} />
        <OfficerCard commission={commission} />
        <RosterCard
          commission={commission}
          imports={imports}
          canOpenRecords={workspace?.readOnly === false}
          className="min-[980px]:col-span-2"
        />
      </div>
    </Page>
  );
}

/** Spec 01 order: Name, Commission key, Issuer code, Type, Categories, Policy version, Created. */
function DetailsCard({ commission }: { commission: Commission }) {
  return (
    <SectionCard id="details" icon={Building03Icon} title={m.details}>
      <DetailList>
        <DetailItem term={m.name}>{commission.name}</DetailItem>
        <DetailItem term={m.commissionKey}>
          <span className="font-mono font-normal">{commission.slug}</span>
        </DetailItem>
        <DetailItem term={m.issuerCode}>
          <span className="font-mono font-normal" title={m.referenceExample(commission.issuerCode)}>
            {commission.issuerCode}
          </span>
        </DetailItem>
        <DetailItem term={m.typeLabel}>
          {commission.type === 'federated' ? m.typeFederatedLong : m.typeHostedLong}
        </DetailItem>
        <DetailItem term={m.categories}>
          {commission.categories.length > 0 ? (
            <ul className="grid gap-2">
              {commission.categories.map((category) => (
                <li
                  key={category.code}
                  className="grid gap-x-2.5 text-sm leading-[1.4] font-normal min-[520px]:grid-cols-[96px_minmax(0,1fr)]"
                >
                  <span className="text-[13px] font-medium text-secondary-foreground tabular-nums">
                    {category.citation}
                  </span>
                  <span>{category.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="font-normal text-muted-foreground">{m.noCategories}</span>
          )}
        </DetailItem>
        <DetailItem term={m.policyVersion}>
          {m.policyVersionValue(commission.policyVersion)}
        </DetailItem>
        <DetailItem term={m.created}>
          <time dateTime={commission.createdAt}>{formatDateTime(commission.createdAt)}</time>
        </DetailItem>
      </DetailList>
    </SectionCard>
  );
}

function OfficerCard({ commission }: { commission: Commission }) {
  const { workspace } = Route.useRouteContext();
  const router = useRouter();
  const { toast } = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const justAssigned = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // A fresh dialog (draft and Idempotency-Key) each time it opens: cancelling discards both.
  const [dialogSession, setDialogSession] = useState(0);
  const [resending, setResending] = useState(false);
  const canWrite = workspace?.readOnly === false;
  const officer = commission.reportingOfficer;

  const openChange = (open: boolean) => {
    if (open) setDialogSession((session) => session + 1);
    setDialogOpen(open);
  };

  const assigned = (updated: Commission) => {
    // A first assignment removes its trigger (the empty state), so focus goes to the heading.
    justAssigned.current = officer === null;
    setDialogOpen(false);
    const now = updated.reportingOfficer;
    // The activated officer corrected in place: no invitation went out.
    const corrected = now !== null && now.id === officer?.id && now.state === 'activated';
    toast({
      title: corrected ? m.detailsSavedToast(now.name) : m.invitationSentToast(now?.email ?? ''),
    });
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
      goToSignIn(`/commissions/${commission.slug}`);
      return;
    }
    const outcome = resendOutcome(result.ok ? null : result.error, officer.email);
    toast({ title: outcome.title, urgency: outcome.destructive ? 'assertive' : 'polite' });
    if (outcome.refetch) void router.invalidate();
  };

  return (
    <SectionCard
      id="reporting-officer"
      icon={UserSquareIcon}
      title={m.officerCardTitle}
      headingRef={headingRef}
    >
      <Dialog open={dialogOpen} onOpenChange={openChange}>
        {officer ? (
          <>
            <DetailList>
              <DetailItem term={m.officerName}>{officer.name}</DetailItem>
              <DetailItem term={m.officerEmail}>
                <span className="break-all">{officer.email}</span>
              </DetailItem>
              <DetailItem term={m.officerPhone}>
                <span className="tabular-nums">{formatPhone(officer.phone)}</span>
              </DetailItem>
              <DetailItem term={m.officerState}>
                <OfficerStateBadge state={officer.state} />
              </DetailItem>
              {officer.state === 'activated' && officer.activatedAt ? (
                <DetailItem term={m.officerActivatedOn}>
                  <time dateTime={officer.activatedAt}>{formatDate(officer.activatedAt)}</time>
                </DetailItem>
              ) : (
                <DetailItem term={m.officerInvitedOn}>
                  <time dateTime={officer.invitedAt}>{formatDate(officer.invitedAt)}</time>{' '}
                  <span
                    className="text-[13px] font-normal text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {m.officerAgo(formatRelativeDate(officer.invitedAt))}
                  </span>
                </DetailItem>
              )}
            </DetailList>
            {officer.state === 'invited' ? (
              <p className="flex items-start gap-2 px-5 pb-4 text-[13px] text-muted-foreground">
                <Icon icon={Clock01Icon} className="mt-0.5 size-3.5" />
                <span>{m.officerLinkValidity}</span>
              </p>
            ) : null}
            {canWrite ? (
              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3.5">
                {officer.state === 'invited' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={resending}
                    aria-busy={resending || undefined}
                    onClick={() => void resend()}
                  >
                    {resending ? (
                      <>
                        <Icon icon={Loading03Icon} className="animate-spin" />
                        {m.officerResending}
                      </>
                    ) : (
                      <>
                        <Icon icon={SentIcon} />
                        {m.officerResend}
                      </>
                    )}
                  </Button>
                ) : null}
                <DialogTrigger asChild>
                  <Button variant="secondary" size="sm" disabled={resending}>
                    <Icon icon={ArrowDataTransferHorizontalIcon} />
                    {m.officerReplace}
                  </Button>
                </DialogTrigger>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={<Icon icon={UserAdd01Icon} />}
            title={m.officerNoneTitle}
            description={m.officerNoneText}
            action={
              canWrite ? (
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Icon icon={UserAdd01Icon} />
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
    </SectionCard>
  );
}
