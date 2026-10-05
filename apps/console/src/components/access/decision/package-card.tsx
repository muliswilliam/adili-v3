import {
  Alert,
  AlertDescription,
  AlertTitle,
  accessMessages,
  Badge,
  DeadlineChip,
  deadlineSoonDays,
  formatDate,
  formatDateTime,
  grantPackageStatus,
  Icon,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon, FileRemoveIcon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { useNowAt } from '../../use-now-at';
import { SideCard } from '../side-cards';
import type { Decision, Package } from './decision-rules';
import { messages as m } from './messages';

/** Where a granted request's package stands for the officer. */
export type PackageState =
  /** The workflow is rendering, watermarking and signing it (or the nil letter). */
  | { state: 'preparing' }
  /** Issuing it failed after its retries (`packageFailedAt`). */
  | { state: 'failed'; at: string }
  | { state: 'issued'; package: Package; lastDownloadAt: string | null }
  | { state: 'closed'; package: Package; lastDownloadAt: string | null };

/**
 * The package of a decided request at `now`, or null for a denial. Downloads are the
 * documents service's, counted on the package; the last one is the latest `downloaded`
 * register entry. The package is the access package or, when the granted scope held nothing,
 * the nil letter (`package.kind`); before either, it is being prepared, or its issuing failed
 * (the shared rule every audience reads, `grantPackageStatus`).
 */
export function packageState(
  decision: Pick<Decision, 'outcome'>,
  pkg: Package | null,
  packageFailedAt: string | null,
  downloadedAt: readonly string[],
  now: number,
): PackageState | null {
  if (decision.outcome === 'deny') return null;
  const status = grantPackageStatus(pkg, packageFailedAt);
  if (status === 'failed' && packageFailedAt !== null) {
    return { state: 'failed', at: packageFailedAt };
  }
  if (!pkg) return { state: 'preparing' };
  const lastDownloadAt = [...downloadedAt].sort().at(-1) ?? null;
  return Date.parse(pkg.downloadExpiresAt) <= now
    ? { state: 'closed', package: pkg, lastDownloadAt }
    : { state: 'issued', package: pkg, lastDownloadAt };
}

/**
 * `packageState` read against the loader's `now`, moving on by itself when an issued package's
 * download window closes, so the card says so without a reload.
 */
export function usePackageState(
  decision: Pick<Decision, 'outcome'> | null,
  pkg: Package | null,
  packageFailedAt: string | null,
  downloadedAt: readonly string[],
  serverNow: string,
): PackageState | null {
  const turnsAt = pkg ? Date.parse(pkg.downloadExpiresAt) : null;
  const now = useNowAt(Date.parse(serverNow), turnsAt);
  return decision ? packageState(decision, pkg, packageFailedAt, downloadedAt, now) : null;
}

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function Confidential() {
  return (
    <Badge variant="destructive" className="text-sm">
      <Icon icon={SquareLock02Icon} strokeWidth={2.2} />
      {m.confidential}
    </Badge>
  );
}

/**
 * A granted request's package (S7) as the officer sees it: never the file, only that it is
 * preparing, that its issuing failed, or when it was issued, until when it can be downloaded
 * (ends today, closed), how many times it was, the watermark it carries and its verification
 * code. When the granted scope held nothing, it is the nil letter (decision 1), shown alike
 * under its own name. Form K and law enforcement requests (#265) alike.
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
  if (state.state === 'failed') {
    return (
      <SideCard
        id="package"
        title={m.packageTitle}
        titleClassName="text-sm"
        actions={<Confidential />}
      >
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertTitle>{accessMessages.packageFailed}</AlertTitle>
          <AlertDescription>{m.packageFailedWhy(formatDateTime(state.at))}</AlertDescription>
        </Alert>
      </SideCard>
    );
  }
  if (state.state === 'preparing') {
    return (
      <SideCard
        id="package"
        title={m.packageTitle}
        titleClassName="text-sm"
        actions={<Confidential />}
      >
        <div role="status" className="flex items-start gap-2.5 text-sm">
          <Spinner className="mt-0.5 size-4 shrink-0 text-foreground" />
          {m.preparing}
        </div>
      </SideCard>
    );
  }
  const { package: pkg, lastDownloadAt } = state;
  const closed = state.state === 'closed';
  const nil = pkg.kind === 'nil-letter';
  return (
    <SideCard
      id="package"
      title={nil ? accessMessages.nilLetter : m.packageTitle}
      titleClassName="text-sm"
      actions={<Confidential />}
    >
      {nil ? (
        <p className="flex items-start gap-2.5 text-sm">
          <Icon icon={FileRemoveIcon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="font-medium">{accessMessages.nilLetterStatement}</span>{' '}
            <span className="text-muted-foreground">{m.nilLetterWhy}</span>
          </span>
        </p>
      ) : null}
      <dl className="grid gap-3 text-sm">
        <Item term={m.issued}>{formatDateTime(pkg.issuedAt)}</Item>
        <Item term={closed ? m.windowClosed : m.downloadUntil}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {formatDateTime(pkg.downloadExpiresAt)}
            {closed ? (
              <Badge variant="warning" className="text-sm">
                {m.closedBadge}
              </Badge>
            ) : (
              <DeadlineChip
                due={pkg.downloadExpiresAt}
                soonDays={deadlineSoonDays.download}
                label={m.downloadUntil}
                todayText={m.endsToday}
                className="text-sm"
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
              <span className="font-mono text-sm">{reference}</span> ·
            </span>{' '}
            <span className="whitespace-nowrap">{formatDate(pkg.issuedAt)}</span>
          </span>
          <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
            {m.watermarkHint}
          </span>
        </Item>
        <Item term={m.verificationCode}>
          <span className="font-mono text-sm break-all">{pkg.verificationId}</span>
        </Item>
      </dl>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon icon={SquareLock02Icon} className="size-3.5" />
        {m.onlyRecipient(recipientName)}
      </p>
    </SideCard>
  );
}
