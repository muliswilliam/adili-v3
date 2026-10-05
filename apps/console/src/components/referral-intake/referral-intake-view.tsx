import {
  Button,
  Card,
  cn,
  EmptyState,
  FilterChip,
  focusRing,
  formatDate,
  Icon,
  InfoTip,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
  useToast,
} from '@adili/ui';
import {
  ArrowRight01Icon,
  Download04Icon,
  FilterIcon,
  Flag02Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { getIntakePackageLink, pushReferralToIcms } from '../../server/referral-intake';
import type { ReferralIntakeItem, ReferralIntakePage } from '../../server/reporting/types';
import type { ServiceResult } from '../../server/service-call';
import type { FailureText } from '../dialog-parts';
import { downloadFrom } from '../download';
import { LoadError } from '../load-error';
import { usePollWhile } from '../use-poll-while';
import { ConfidentialBadge } from '../referrals/badges';
import { IcmsStatusBadge, PushButton, pushAction } from './icms-status';
import { messages as t } from './messages';
import { PushDialog } from './push-dialog';
import { ReferralIntakeDrawer } from './referral-intake-drawer';
import { ICMS_STATUSES } from '../../server/reporting/types';

export const INTAKE_FILTERS = ['all', ...ICMS_STATUSES] as const;
export type IntakeFilter = (typeof INTAKE_FILTERS)[number];

/** Reload every 5 seconds while a referral waits for its case number, at most 12 times. */
const PUSHED_POLL_MS = 5_000;
const PUSHED_POLL_TIMES = 12;

/** The table where the list is wide enough, else one card per referral (the prototype's 800px). */
const TABLE_ONLY = 'hidden @[800px]:block';
const CARDS_ONLY = '@[800px]:hidden';

export interface ReferralIntakeViewProps {
  /** The page for `filter`; null while it loads. */
  result: ServiceResult<ReferralIntakePage> | null;
  filter: IntakeFilter;
  onFilterChange: (filter: IntakeFilter) => void;
  /** Whether this is the first page (an empty later page is not "none received"). */
  firstPage: boolean;
  /** Previous and Next, under the rows. */
  pager?: ReactNode;
  /** Whether the viewer pushes referrals to ICMS (EACC analysts); others read the intake. */
  canPush: boolean;
  /** A fresh Idempotency-Key per push confirmation; tests may fix it. */
  newKey?: () => string;
}

/**
 * EACC's referrals received (spec 09 FE-5; S12, S15): the referrals Commissions sent, the latest
 * first, by ICMS status: reference, Commission, grounds, when it was sent, the Confidential
 * evidence package to download, where the hand-off to ICMS stands (the case number once
 * registered, why the last push failed), and Push to ICMS with a confirm, or Retry. A row opens
 * the referral's drawer with its history. After a push the page reloads, so the row shows what
 * reporting recorded. On a phone each referral is a card instead (#542); its package is in the
 * drawer.
 */
export function ReferralIntakeView({
  result,
  filter,
  onFilterChange,
  firstPage,
  pager,
  canPush,
  newKey = () => crypto.randomUUID(),
}: ReferralIntakeViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [pushing, setPushing] = useState<{ referral: ReferralIntakeItem; key: string } | null>(
    null,
  );
  const [downloading, setDownloading] = useState<string | null>(null);
  const items = result?.ok ? result.data.items : [];
  // ICMS assigns a pushed referral's case number shortly after; reload until it shows.
  usePollWhile(
    items.some((each) => each.icmsStatus === 'pushed'),
    PUSHED_POLL_MS,
    PUSHED_POLL_TIMES,
  );
  // The drawer reads the row as last loaded, so it follows a push.
  const opened = items.find((each) => each.referralId === openedId) ?? null;

  function askPush(referral: ReferralIntakeItem) {
    setOpenedId(null);
    setPushing({ referral, key: newKey() });
  }

  async function push(referral: ReferralIntakeItem): Promise<FailureText | null> {
    const key = pushing?.key ?? newKey();
    const answer = await pushReferralToIcms({
      data: { referralId: referral.referralId, idempotencyKey: key },
    }).catch(() => null);
    if (answer?.ok) {
      setPushing(null);
      toast({
        title: answer.data.icmsCaseNumber
          ? t.toasts.registered(answer.data.icmsCaseNumber)
          : t.toasts.pushed,
      });
      await router.invalidate();
      return null;
    }
    if (answer?.pushFailed) {
      setPushing(null);
      toast({ title: t.toasts.failed, urgency: 'assertive' });
      await router.invalidate();
      return null;
    }
    if (answer?.error.kind === 'unauthenticated') return { title: t.toasts.sessionEnded };
    if (answer?.error.kind === 'problem') {
      const { status } = answer.error.problem;
      return {
        title: status === 403 || status === 404 ? t.pushRefused[status] : t.pushRefused.other,
      };
    }
    return { title: t.pushUnanswered.title, detail: t.pushUnanswered.detail };
  }

  async function download(referral: ReferralIntakeItem) {
    setDownloading(referral.referralId);
    const link = await getIntakePackageLink({
      data: { packageDocumentId: referral.packageDocumentId },
    }).catch(() => ({ ok: false }) as const);
    setDownloading(null);
    if (link.ok) downloadFrom(link.data.downloadUrl);
    else toast({ title: t.toasts.downloadFailed, urgency: 'assertive' });
  }

  return (
    <>
      <Card className="@container overflow-hidden p-0 sm:p-0">
        {result?.ok && !(firstPage && filter === 'all' && items.length === 0) ? (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <div role="group" aria-label={t.list.filtersLabel} className="flex flex-wrap gap-1.5">
              {INTAKE_FILTERS.map((each) => (
                <FilterChip
                  key={each}
                  pressed={filter === each}
                  onPressedChange={() => {
                    onFilterChange(each);
                  }}
                >
                  {t.list.filters[each]}
                </FilterChip>
              ))}
            </div>
          </div>
        ) : null}
        {result === null ? (
          <ListSkeleton />
        ) : !result.ok ? (
          <div className="p-5">
            <LoadError
              title={t.list.loadFailed.title}
              detail={t.list.loadFailed.body}
              retryLabel={t.list.loadFailed.retry}
            />
          </div>
        ) : items.length === 0 && firstPage ? (
          filter === 'all' ? (
            <EmptyState
              icon={<Icon icon={Flag02Icon} />}
              title={t.list.emptyTitle}
              description={t.list.emptyBody}
            />
          ) : (
            <EmptyState
              icon={<Icon icon={FilterIcon} />}
              title={t.list.noMatchesTitle}
              description={t.list.noMatchesBody}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onFilterChange('all');
                  }}
                >
                  {t.list.showAll}
                </Button>
              }
            />
          )
        ) : (
          <>
            <div className={TABLE_ONLY}>
              <Table caption={t.list.caption} className="[&_caption]:sr-only">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.list.reference}</TableHead>
                    <TableHead>{t.list.commission}</TableHead>
                    <TableHead>{t.list.groundsColumn}</TableHead>
                    <TableHead>{t.list.sent}</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1.5">
                        {t.list.packageColumn}
                        <InfoTip label={t.list.packageColumn} content={t.packageTip} />
                      </span>
                    </TableHead>
                    <TableHead>{t.list.icmsStatus}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t.list.actions}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((referral) => (
                    <TableRow
                      key={referral.referralId}
                      className="cursor-pointer"
                      onClick={(event) => {
                        // A click on a control in the row is that control's; anywhere else opens it.
                        if (!(event.target as HTMLElement).closest('button, a')) {
                          setOpenedId(referral.referralId);
                        }
                      }}
                    >
                      <TableCell className="whitespace-nowrap">
                        <button
                          type="button"
                          className={cn(
                            'rounded-sm font-mono text-[13.5px] font-semibold hover:underline',
                            focusRing,
                          )}
                          onClick={() => {
                            setOpenedId(referral.referralId);
                          }}
                        >
                          {referral.reference}
                        </button>
                      </TableCell>
                      <TableCell className="min-w-[160px]">{referral.commission.name}</TableCell>
                      <TableCell className="min-w-[150px]">{t.grounds[referral.grounds]}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(referral.sentAt)}
                      </TableCell>
                      <TableCell>
                        <div className="grid justify-items-start gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label={t.list.packageFor(referral.reference)}
                            disabled={downloading === referral.referralId}
                            onClick={() => void download(referral)}
                          >
                            <Icon icon={Download04Icon} />
                            {t.list.package}
                          </Button>
                          <ConfidentialBadge />
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[170px]">
                        <IcmsStatusDetail referral={referral} />
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {canPush && pushAction(referral) ? (
                            <PushButton referral={referral} size="sm" onPush={askPush} />
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={t.list.viewFor(referral.reference)}
                              onClick={() => {
                                setOpenedId(referral.referralId);
                              }}
                            >
                              {t.list.view}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul aria-label={t.list.caption} className={CARDS_ONLY}>
              {items.map((referral) => (
                <IntakeCard
                  key={referral.referralId}
                  referral={referral}
                  onOpen={() => {
                    setOpenedId(referral.referralId);
                  }}
                  onPush={canPush ? askPush : null}
                />
              ))}
            </ul>
            {pager}
          </>
        )}
      </Card>

      <ReferralIntakeDrawer
        referral={opened}
        onClose={() => {
          setOpenedId(null);
        }}
        onPush={canPush ? askPush : null}
        onDownload={(referral) => void download(referral)}
        downloading={opened !== null && downloading === opened.referralId}
      />
      <PushDialog
        key={pushing?.key ?? 'closed'}
        referral={pushing?.referral ?? null}
        onOpenChange={(open) => {
          if (!open) setPushing(null);
        }}
        onConfirm={push}
      />
    </>
  );
}

/**
 * A referral on a phone, as the prototype's intake card: reference, Commission and sent date,
 * grounds, the ICMS status line, and Push to ICMS or Retry where the viewer pushes. The whole card
 * opens the drawer through its reference, the card's one link. Push or Retry is its own control.
 */
function IntakeCard({
  referral,
  onOpen,
  onPush,
}: {
  referral: ReferralIntakeItem;
  onOpen: () => void;
  /** Null where the viewer does not push (EACC supervisors). */
  onPush: ((referral: ReferralIntakeItem) => void) | null;
}) {
  return (
    <li className="relative grid gap-2.5 border-b px-4 py-3.5 transition-colors last:border-b-0 has-[[data-row-link]:hover]:bg-muted/50">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <TableRowLink asChild>
            <button
              type="button"
              className="rounded-sm text-left font-mono text-[13.5px] font-semibold"
              onClick={onOpen}
            >
              {referral.reference}
            </button>
          </TableRowLink>
          <p className="text-[13px] text-muted-foreground">
            {t.list.cardMeta(referral.commission.name, referral.sentAt)}
          </p>
        </div>
        <Icon icon={ArrowRight01Icon} className="mt-0.5 flex-none text-muted-foreground" />
      </div>
      <p className="text-[13px]">{t.grounds[referral.grounds]}</p>
      <IcmsStatusDetail referral={referral} />
      {onPush && pushAction(referral) ? (
        // Above the card's stretched link, so the button is its own.
        <div className="relative z-10 justify-self-start">
          <PushButton referral={referral} size="sm" onPush={onPush} />
        </div>
      ) : null}
    </li>
  );
}

/** The ICMS status, with the case number, the wait for it, or why the push failed. */
function IcmsStatusDetail({ referral }: { referral: ReferralIntakeItem }) {
  return (
    <div className="grid justify-items-start gap-1">
      <IcmsStatusBadge status={referral.icmsStatus} />
      {referral.icmsStatus === 'registered' && referral.icmsCaseNumber ? (
        <span className="font-mono text-[12.5px] text-muted-foreground">
          {referral.icmsCaseNumber}
        </span>
      ) : referral.icmsStatus === 'pushed' ? (
        <span className="text-[12.5px] text-muted-foreground">{t.waitingForCase}</span>
      ) : referral.icmsStatus === 'push-failed' && referral.error ? (
        <span className="max-w-[220px] text-[12.5px] whitespace-normal text-destructive">
          {t.pushErrors[referral.error]}
        </span>
      ) : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 p-5" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((each) => (
        <Skeleton key={each} className="h-10 w-full" />
      ))}
    </div>
  );
}
