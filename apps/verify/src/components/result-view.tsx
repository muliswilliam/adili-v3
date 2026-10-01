import { findScheme, parse } from '@adili/numbering/references';
import {
  Button,
  DescriptionItem,
  DescriptionList,
  declarationReferenceParts,
  formatDateTime,
  Icon,
  ReferenceChip,
  Skeleton,
  useCountdown,
  VersionBadge,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight02Icon,
  Cancel01Icon,
  Clock01Icon,
  InformationCircleIcon,
  RefreshIcon,
  SecurityCheckIcon,
  Tick02Icon,
  Timer02Icon,
  UnavailableIcon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

import { documentTypeName, verifyMessages as copy } from '../copy';
import type { LookupOutcome } from '../lib/lookup-outcome';
import type { VerificationResult, VerifiedDocument } from '../server/verification/types';
import { StatusCard, type StatusTone } from './status-card';

// The file check (hashing, the drop zone and its states) is below the answer and only for
// someone holding the PDF, so it loads after the page; a server-rendered page shows it at once.
const HashDropZone = lazy(async () => ({
  default: (await import('@adili/ui/hash-drop-zone')).HashDropZone,
}));

type Found = Extract<LookupOutcome, { kind: 'found' }>['result'];

export interface ResultViewProps {
  /** The code as it is in the URL, normalised when it is well formed. */
  code: string;
  outcome: LookupOutcome;
  /** Asks the API again (rate limited, unavailable). */
  onRetry: () => void;
}

/** The result page for a verification code: one of the lookup outcomes. */
export function ResultView({ code, outcome, onRetry }: ResultViewProps) {
  return (
    <div className="grid gap-[18px]">
      <CodeHeader code={code} />
      <Outcome code={code} outcome={outcome} onRetry={onRetry} />
    </div>
  );
}

function Outcome({ code, outcome, onRetry }: ResultViewProps) {
  switch (outcome.kind) {
    case 'found':
      return <FoundDocument result={outcome.result} />;
    case 'not-found':
      return (
        <>
          <StatusCard
            tone="destructive"
            icon={Cancel01Icon}
            title={copy.notFound}
            detail={copy.notFoundDetail}
          >
            <p className="pt-3.5 text-sm text-secondary-foreground">{copy.notFoundHint}</p>
            <Button asChild className="mt-3.5 w-full">
              <Link to="/" search={{ code }}>
                {copy.editCode}
              </Link>
            </Button>
          </StatusCard>
          <PrivacyNote />
        </>
      );
    case 'malformed':
      return (
        <StatusCard
          tone="destructive"
          icon={AlertCircleIcon}
          title={copy.malformed}
          detail={copy.malformedDetail}
        >
          <Button asChild className="mt-3.5 w-full">
            <Link to="/">{copy.tryAgain}</Link>
          </Button>
        </StatusCard>
      );
    case 'rate-limited':
      return <RateLimited seconds={outcome.retryAfterSeconds} onRetry={onRetry} />;
    case 'unavailable':
      return (
        <StatusCard
          tone="neutral"
          icon={WifiDisconnected01Icon}
          title={copy.unavailable}
          detail={copy.unavailableDetail}
        >
          <Button type="button" className="mt-3.5 w-full" onClick={onRetry}>
            <Icon icon={RefreshIcon} />
            {copy.tryAgain}
          </Button>
        </StatusCard>
      );
  }
}

function CodeHeader({ code }: { code: string }) {
  return (
    <div className="grid justify-items-start gap-3.5">
      <Button asChild variant="ghost" size="sm" className="-mt-1.5 -ml-2.5">
        <Link to="/">
          <Icon icon={ArrowLeft01Icon} />
          {copy.checkAnother}
        </Link>
      </Button>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{copy.codeCaption}</p>
        <p className="mt-0.5 font-mono text-base font-semibold">{code}</p>
      </div>
    </div>
  );
}

const FOUND: Record<
  Found['status'],
  { tone: StatusTone; icon: typeof Tick02Icon; title: string; detail: (result: Found) => string }
> = {
  valid: {
    tone: 'success',
    icon: Tick02Icon,
    title: copy.valid,
    detail: (result) => (result.document ? copy.validDetail : copy.validConfidentialDetail),
  },
  superseded: {
    tone: 'warning',
    icon: RefreshIcon,
    title: copy.superseded,
    detail: () => copy.supersededDetail,
  },
  revoked: {
    tone: 'destructive',
    icon: UnavailableIcon,
    title: copy.revoked,
    detail: (result) => copy.revokedDetail(result.revokedReason),
  },
  expired: {
    tone: 'neutral',
    icon: Clock01Icon,
    title: copy.expired,
    detail: () => copy.expiredDetail,
  },
};

function FoundDocument({ result }: { result: Found }) {
  const state = FOUND[result.status];
  const document = result.document;
  const confidential = !document && result.status === 'valid';
  return (
    <>
      <StatusCard
        tone={state.tone}
        icon={confidential ? SecurityCheckIcon : state.icon}
        title={state.title}
        detail={state.detail(result)}
      >
        {document || result.status === 'superseded' ? (
          <>
            {document ? <DocumentDetails document={document} status={result.status} /> : null}
            {result.status === 'superseded' ? (
              <CurrentVersion supersededBy={result.supersededBy} />
            ) : null}
          </>
        ) : null}
      </StatusCard>
      {result.sha256 ? (
        <FileCheck sha256={result.sha256} version={document?.version ?? null} />
      ) : null}
      <PrivacyNote />
    </>
  );
}

function DocumentDetails({
  document,
  status,
}: {
  document: VerifiedDocument;
  status: Found['status'];
}) {
  const versionState =
    status === 'valid' ? 'current' : status === 'superseded' ? 'superseded' : undefined;
  return (
    <>
      <DescriptionList className="*:first:pt-[11px] *:last:pb-[11px] [&>div]:items-center max-[479px]:[&>div]:flex-col max-[479px]:[&>div]:items-start max-[479px]:[&>div]:gap-1 max-[479px]:[&_dd]:text-left">
        <DescriptionItem term={copy.documentType}>
          {documentTypeName(document.type)}
        </DescriptionItem>
        <DescriptionItem term={copy.issuedBy}>{document.issuerName}</DescriptionItem>
        {document.reference ? (
          <DescriptionItem term={copy.reference}>
            <ReferenceChip
              reference={document.reference}
              parts={referenceParts(document)}
              copyable={false}
              size="sm"
            />
          </DescriptionItem>
        ) : null}
        {document.version !== null ? (
          <DescriptionItem term={copy.version}>
            <VersionBadge version={document.version} state={versionState} />
          </DescriptionItem>
        ) : null}
        <DescriptionItem term={copy.issuedOn}>
          <time dateTime={document.issuedAt}>{formatDateTime(document.issuedAt)}</time>
        </DescriptionItem>
      </DescriptionList>
      <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Icon icon={InformationCircleIcon} className="size-3.5" />
        {copy.compare}
      </p>
    </>
  );
}

/**
 * What each part of a declaration reference means, from the numbering scheme registry. Other
 * references, and any that do not parse, show without a breakdown.
 */
function referenceParts(document: VerifiedDocument) {
  const scheme = document.reference ? parsedScheme(document.reference) : undefined;
  if (!scheme?.issuer || !scheme.period) return undefined;
  return declarationReferenceParts({ type: scheme.name, issuer: document.issuerName });
}

function parsedScheme(reference: string) {
  try {
    return findScheme(parse(reference).scheme);
  } catch {
    return undefined;
  }
}

function CurrentVersion({ supersededBy }: { supersededBy: VerificationResult['supersededBy'] }) {
  if (!supersededBy) {
    return (
      <p className="mt-3.5 flex items-start gap-2.5 rounded-lg bg-warning-subtle px-3.5 py-3 text-sm text-warning-subtle-foreground">
        <Icon icon={InformationCircleIcon} className="mt-px size-[18px]" />
        {copy.askForCurrent}
      </p>
    );
  }
  return (
    <Button asChild variant="secondary" size="sm" className="mt-3.5">
      <Link to="/v/$verificationId" params={{ verificationId: supersededBy }}>
        {copy.viewCurrent}
        <Icon icon={ArrowRight02Icon} />
      </Link>
    </Button>
  );
}

function FileCheck({ sha256, version }: { sha256: string; version: number | null }) {
  return (
    <section
      aria-labelledby="check-file"
      className="rounded-2xl bg-card p-5 text-card-foreground shadow-card sm:p-6"
    >
      <h2 id="check-file" className="mb-3 text-base font-semibold tracking-[-0.01em]">
        {copy.checkFileHeading}
      </h2>
      <Suspense fallback={<Skeleton className="h-[214px] rounded-2xl" />}>
        <HashDropZone
          expectedSha256={sha256}
          messages={{ identicalDetail: copy.identicalDetail(version) }}
        />
      </Suspense>
    </section>
  );
}

function RateLimited({ seconds, onRetry }: { seconds: number; onRetry: () => void }) {
  const [left] = useCountdown(seconds);
  return (
    <StatusCard
      tone="warning"
      icon={Timer02Icon}
      title={copy.rateLimited}
      detail={<span aria-live="off">{copy.rateLimitedDetail(left)}</span>}
    >
      <p className="pt-3 text-sm text-muted-foreground">{copy.rateLimitedNote}</p>
      <Button type="button" className="mt-3.5 w-full" disabled={left > 0} onClick={onRetry}>
        {copy.tryAgain}
      </Button>
    </StatusCard>
  );
}

export function PrivacyNote() {
  return (
    <p className="text-center text-sm text-muted-foreground">
      {copy.neverShown}{' '}
      <Link
        to="/about"
        className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
      >
        {copy.why}
      </Link>
    </p>
  );
}
