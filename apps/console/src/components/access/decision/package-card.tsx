import {
  Badge,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  formatDateTime,
  Icon,
  Spinner,
} from '@adili/ui';
import { SquareLock02Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { SideCard } from '../side-cards';
import type { Decision, Package } from './decision-rules';
import { messages as m } from './messages';

/** Days a granted package can be downloaded (the access service's PACKAGE_DOWNLOAD_DAYS). */
export const PACKAGE_DOWNLOAD_DAYS = 14;

/** Where a granted request's package stands for the officer. */
export type PackageState =
  /** Granted; the workflow is rendering, watermarking and signing it. */
  | { state: 'preparing' }
  | { state: 'issued'; package: Package; lastDownloadAt: string | null }
  | { state: 'closed'; package: Package; lastDownloadAt: string | null };

/**
 * The package of a decided request at `now`, or null for a denial. Downloads are the
 * documents service's, counted on the package; the last one is the latest `downloaded`
 * register entry. Until the package is issued it is preparing (also when the granted scope
 * turned out to hold nothing to disclose: the access service leaves it unissued, #259).
 */
export function packageState(
  decision: Pick<Decision, 'outcome'>,
  pkg: Package | null,
  downloadedAt: readonly string[],
  now: number,
): PackageState | null {
  if (decision.outcome === 'deny') return null;
  if (!pkg) return { state: 'preparing' };
  const lastDownloadAt = [...downloadedAt].sort().at(-1) ?? null;
  return Date.parse(pkg.downloadExpiresAt) <= now
    ? { state: 'closed', package: pkg, lastDownloadAt }
    : { state: 'issued', package: pkg, lastDownloadAt };
}

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function Confidential() {
  return (
    <Badge variant="destructive">
      <Icon icon={SquareLock02Icon} strokeWidth={2.2} />
      {m.confidential}
    </Badge>
  );
}

/**
 * A granted request's package (S7) as the officer sees it: never the file, only that it is
 * preparing, or when it was issued, until when it can be downloaded (ends today, closed), how
 * many times it was, the watermark it carries and its verification code. Form K and law
 * enforcement requests (#265) alike.
 */
export function PackageCard({
  state,
  recipientName,
  reference,
}: {
  state: PackageState;
  /** Whose name the watermark carries, and who alone can download it. */
  recipientName: string;
  reference: string;
}) {
  if (state.state === 'preparing') {
    return (
      <SideCard id="package" title={m.packageTitle} actions={<Confidential />}>
        <div role="status" className="flex items-start gap-2.5 text-sm">
          <Spinner className="mt-0.5 size-4 shrink-0 text-foreground" />
          {m.preparing}
        </div>
      </SideCard>
    );
  }
  const { package: pkg, lastDownloadAt } = state;
  const closed = state.state === 'closed';
  return (
    <SideCard id="package" title={m.packageTitle} actions={<Confidential />}>
      <dl className="grid gap-3 text-sm">
        <Item term={m.issued}>{formatDateTime(pkg.issuedAt)}</Item>
        <Item term={closed ? m.windowClosed : m.downloadUntil}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {formatDateTime(pkg.downloadExpiresAt)}
            {closed ? (
              <Badge variant="warning">{m.closedBadge}</Badge>
            ) : (
              <DeadlineChip
                due={pkg.downloadExpiresAt}
                soonDays={deadlineSoonDays.download}
                label={m.downloadUntil}
                todayText={m.endsToday}
              />
            )}
          </span>
        </Item>
        <Item term={m.downloads}>
          {String(pkg.downloads)}
          {lastDownloadAt ? (
            <span className="font-normal text-muted-foreground">
              {' '}
              · {m.lastDownload(formatDateTime(lastDownloadAt))}
            </span>
          ) : null}
        </Item>
        <Item term={m.watermark}>
          <span className="font-normal">
            {/* Each part with its separator stays whole, so a line never starts with "·". */}
            <span className="whitespace-nowrap">{recipientName} ·</span>{' '}
            <span className="whitespace-nowrap">
              <span className="font-mono text-[13px]">{reference}</span> ·
            </span>{' '}
            <span className="whitespace-nowrap">{formatDate(pkg.issuedAt)}</span>
          </span>
          <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
            {m.watermarkHint}
          </span>
        </Item>
        <Item term={m.verificationCode}>
          <span className="font-mono text-[13px] break-all">{pkg.verificationId}</span>
        </Item>
      </dl>
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Icon icon={SquareLock02Icon} className="size-3.5" />
        {m.onlyRecipient(recipientName)}
      </p>
    </SideCard>
  );
}
