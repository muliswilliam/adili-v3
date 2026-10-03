import {
  Button,
  Card,
  cn,
  EmptyState,
  FilterChip,
  focusRing,
  formatDate,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@adili/ui';
import {
  Download04Icon,
  FilterIcon,
  Flag02Icon,
  RefreshIcon,
  SentIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { getIntakePackageLink, pushReferralToIcms } from '../../server/referral-intake';
import type { ReferralIntakeItem, ReferralIntakePage } from '../../server/reporting/types';
import type { ServiceResult } from '../../server/service-call';
import type { FailureText } from '../dialog-parts';
import { downloadFrom } from '../download';
import { InfoTip } from '../info-tip';
import { LoadError } from '../load-error';
import { ConfidentialBadge } from '../referrals/badges';
import { IcmsStatusBadge } from './badges';
import { messages as t } from './messages';
import { PushDialog } from './push-dialog';
import { ReferralIntakeDrawer } from './referral-intake-drawer';
import { ICMS_STATUSES } from './statuses';

export const INTAKE_FILTERS = ['all', ...ICMS_STATUSES] as const;
export type IntakeFilter = (typeof INTAKE_FILTERS)[number];

export interface ReferralIntakeViewProps {
  /** The page for `filter`; null while it loads. */
  result: ServiceResult<ReferralIntakePage> | null;
  filter: IntakeFilter;
  onFilterChange: (filter: IntakeFilter) => void;
  /** Whether this is the first page (an empty later page is not "none received"). */
  firstPage: boolean;
  /** Previous and Next, under the rows. */
  pager?: ReactNode;
  /** A fresh Idempotency-Key per push confirmation; tests may fix it. */
  newKey?: () => string;
}

/** Whether the referral can be pushed (again) to ICMS. */
const pushable = (referral: ReferralIntakeItem) =>
  referral.icmsStatus === 'not-pushed' || referral.icmsStatus === 'push-failed';

/**
 * EACC's referrals received (spec 09 FE-5; S12, S15): the referrals Commissions sent, the latest
 * first, by ICMS status: reference, Commission, grounds, when it was sent, the Confidential
 * evidence package to download, where the hand-off to ICMS stands (the case number once
 * registered, why the last push failed), and Push to ICMS with a confirm, or Retry. A row opens
 * the referral's drawer with its history. After a push the page reloads, so the row shows what
 * reporting recorded.
 */
export function ReferralIntakeView({
  result,
  filter,
  onFilterChange,
  firstPage,
  pager,
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
      <Card className="overflow-hidden p-0 sm:p-0">
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
                  <TableRow key={referral.referralId}>
                    <TableCell className="whitespace-nowrap">
                      <button
                        type="button"
                        className={cn(
                          'font-mono text-[13.5px] font-semibold hover:underline',
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
                      <IcmsStatusCell referral={referral} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {pushable(referral) ? (
                        <Button
                          size="sm"
                          variant={referral.icmsStatus === 'push-failed' ? 'secondary' : 'default'}
                          onClick={() => {
                            askPush(referral);
                          }}
                        >
                          <Icon
                            icon={referral.icmsStatus === 'push-failed' ? RefreshIcon : SentIcon}
                          />
                          {referral.icmsStatus === 'push-failed' ? t.list.retry : t.list.push}
                        </Button>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pager}
          </>
        )}
      </Card>

      <ReferralIntakeDrawer
        referral={opened}
        onClose={() => {
          setOpenedId(null);
        }}
        onPush={askPush}
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

/** The ICMS status, with the case number, the wait for it, or why the push failed. */
function IcmsStatusCell({ referral }: { referral: ReferralIntakeItem }) {
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
