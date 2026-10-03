import {
  AssigneeAvatar,
  Button,
  Card,
  EmptyState,
  FilterChip,
  formatDate,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import { ComputerIcon, Flag02Icon, Search01Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { ReferralsPage } from '../../server/referrals.server';
import type { Referral } from '../../server/review/types';
import type { ServiceResult } from '../../server/service-call';
import { InfoTip } from '../info-tip';
import { LoadError } from '../load-error';
import { ConfidentialBadge, GroundsBadge, ReferralStatusBadge } from './badges';
import { messages as t } from './messages';

export const REFERRAL_FILTERS = ['all', 'proposed', 'approved', 'sent', 'declined'] as const;
export type ReferralFilter = (typeof REFERRAL_FILTERS)[number];

export interface ReferralsListProps {
  /** The page for `filter`; null while it loads. */
  result: ServiceResult<ReferralsPage> | null;
  filter: ReferralFilter;
  onFilterChange: (filter: ReferralFilter) => void;
  /** Whether this is the first page (an empty later page is not "no referrals"). */
  firstPage: boolean;
  /** The referral's reference (or "Proposed") as a link to its page. */
  referralLink: (referral: Referral, label: ReactNode) => ReactNode;
  /** Previous and Next, under the rows. */
  pager?: ReactNode;
}

/**
 * The Commission's referrals to EACC (spec 08 FE-6), newest proposal first, by status: the
 * reference once allocated, the grounds, the declarant and file number, who proposed it (or the
 * system) and when, where it stands and when it was sent. Confidential, and the declarant is
 * never told.
 */
export function ReferralsList({
  result,
  filter,
  onFilterChange,
  firstPage,
  referralLink,
  pager,
}: ReferralsListProps) {
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div role="group" aria-label={t.list.filtersLabel} className="flex flex-wrap gap-1.5">
          {REFERRAL_FILTERS.map((each) => (
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
        <span className="ml-auto inline-flex items-center gap-1.5">
          <ConfidentialBadge />
          <InfoTip label={t.confidential} content={t.confidentialTip} />
        </span>
      </div>
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
      ) : result.data.items.length === 0 && firstPage ? (
        filter === 'all' ? (
          <EmptyState
            icon={<Icon icon={Flag02Icon} />}
            title={t.list.emptyTitle}
            description={t.list.emptyBody}
          />
        ) : (
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
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
                <TableHead>{t.list.groundsColumn}</TableHead>
                <TableHead>{t.list.declarant}</TableHead>
                <TableHead>{t.list.proposer}</TableHead>
                <TableHead>{t.list.status}</TableHead>
                <TableHead>{t.list.sent}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((referral) => (
                <TableRow key={referral.id}>
                  <TableCell className="font-mono text-[13px] font-medium whitespace-nowrap">
                    {referralLink(
                      referral,
                      referral.reference ?? (
                        <span className="font-sans font-normal">{t.list.noReference}</span>
                      ),
                    )}
                  </TableCell>
                  <TableCell>
                    <GroundsBadge grounds={referral.grounds} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{referral.declarantName}</div>
                    {referral.personnelFileNumber ? (
                      <Sub>{t.list.file(referral.personnelFileNumber)}</Sub>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Proposer referral={referral} />
                  </TableCell>
                  <TableCell>
                    <ReferralStatusBadge referral={referral} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {referral.sentAt ? formatDate(referral.sentAt) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pager}
        </>
      )}
    </Card>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <div className="mt-0.5 text-[13px] whitespace-nowrap text-muted-foreground">{children}</div>
  );
}

function Proposer({ referral }: { referral: Referral }) {
  return (
    <>
      <div className="flex items-center gap-2 font-medium whitespace-nowrap">
        {referral.proposer ? (
          <AssigneeAvatar name={referral.proposer.name} />
        ) : (
          <Icon icon={ComputerIcon} className="size-4 text-muted-foreground" />
        )}
        {referral.proposer?.name ?? t.system}
      </div>
      <Sub>{formatDate(referral.proposedAt)}</Sub>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 p-5" aria-busy="true">
      {[0, 1, 2, 3, 4].map((each) => (
        <Skeleton key={each} className="h-10 w-full" />
      ))}
    </div>
  );
}
