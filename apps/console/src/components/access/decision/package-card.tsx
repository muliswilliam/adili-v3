import {
  Badge,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  formatDateTime,
  Icon,
  PACKAGE_PREPARING_FOR_MS,
  Spinner,
  unissuedPackageState,
} from '@adili/ui';
import { PackageRemoveIcon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { useNowAt } from '../../use-now-at';
import { SideCard } from '../side-cards';
import type { Decision, Package } from './decision-rules';
import { messages as m } from './messages';

/** Where a granted request's package stands for the officer. */
export type PackageState =
  /** Granted within the hour; the workflow is rendering, watermarking and signing it. */
  | { state: 'preparing' }
  /** Granted over an hour ago and still nothing: nothing to disclose, or issuing failed. */
  | { state: 'missing' }
  | { state: 'issued'; package: Package; lastDownloadAt: string | null }
  | { state: 'closed'; package: Package; lastDownloadAt: string | null };

/**
 * The package of a decided request at `now`, or null for a denial. Downloads are the
 * documents service's, counted on the package; the last one is the latest `downloaded`
 * register entry. A package not issued yet reads as preparing for an hour after the grant,
 * then as missing (the access service leaves a grant with nothing to disclose unissued, #259):
 * the shared rule every audience reads (`unissuedPackageState`).
 */
export function packageState(
  decision: Pick<Decision, 'outcome' | 'decidedAt'>,
  pkg: Package | null,
  downloadedAt: readonly string[],
  now: number,
): PackageState | null {
  if (decision.outcome === 'deny') return null;
  if (!pkg) return { state: unissuedPackageState(decision.decidedAt, now) };
  const lastDownloadAt = [...downloadedAt].sort().at(-1) ?? null;
  return Date.parse(pkg.downloadExpiresAt) <= now
    ? { state: 'closed', package: pkg, lastDownloadAt }
    : { state: 'issued', package: pkg, lastDownloadAt };
}

/**
 * `packageState` read against the loader's `now`, moving on by itself when a package not issued
 * stops reading as preparing (an hour after the grant), so the card says it was not issued
 * without a reload.
 */
export function usePackageState(
  decision: Pick<Decision, 'outcome' | 'decidedAt'> | null,
  pkg: Package | null,
  downloadedAt: readonly string[],
  serverNow: string,
): PackageState | null {
  const turnsAt =
    decision && decision.outcome !== 'deny' && !pkg
      ? Date.parse(decision.decidedAt) + PACKAGE_PREPARING_FOR_MS
      : null;
  const now = useNowAt(Date.parse(serverNow), turnsAt);
  return decision ? packageState(decision, pkg, downloadedAt, now) : null;
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
  if (state.state === 'missing') {
    return (
      <SideCard id="package" title={m.packageTitle} actions={<Confidential />}>
        <p className="flex items-start gap-2.5 text-sm">
          <Icon icon={PackageRemoveIcon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="font-medium">{m.noPackage}</span>{' '}
            <span className="text-muted-foreground">{m.noPackageWhy}</span>
          </span>
        </p>
      </SideCard>
    );
  }
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
