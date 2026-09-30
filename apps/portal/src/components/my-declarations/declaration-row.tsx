import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Icon,
  IconTile,
  obligationTypeLabel,
  ProgressBar,
  ReferenceChip,
  Skeleton,
  Spinner,
  useToast,
  VersionBadge,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Clock01Icon,
  Download01Icon,
  PencilEdit02Icon,
  RefreshIcon,
  SquareLock01Icon,
  Tick02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';

import { amendAvailability } from '../../declaration/my-declarations';
import type { DeclarationListItem, DeclarationVersion } from '../../server/declarations/types';
import { getMyDeclarationVersions } from '../../server/my-declarations';
import type { FiledDeclaration } from '../../server/my-declarations.server';
import { getMySlipDownload } from '../../server/submission';
import { DISCARDED_TOAST, DiscardDraftButton } from '../declaration/discard-dialog';
import {
  DISCARD_AMENDMENT_COPY,
  DiscardAmendmentButton,
} from '../declaration/discard-amendment-dialog';
import { referenceParts } from '../../declaration/reference-parts';
import { downloadFrom } from '../download';
import { signInAgain } from '../sign-in';
import { AmendButton } from './amend-dialog';
import { MY_DECLARATIONS_COPY as COPY } from './copy';

type Acknowledgement = FiledDeclaration['acknowledgement'];

function RowFrame({
  mark,
  title,
  badge,
  children,
  bar,
  after,
}: {
  mark: ReactNode;
  title: string;
  badge: ReactNode;
  children: ReactNode;
  bar: ReactNode;
  after?: ReactNode;
}) {
  return (
    <li className="rounded-2xl bg-card text-card-foreground shadow-card">
      <article aria-label={title}>
        <div className="flex flex-wrap items-start gap-3.5 px-5 py-[18px]">
          {mark}
          <div className="min-w-[240px] flex-1">
            <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
            {children}
          </div>
          {badge}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {bar}
        </div>
        {after}
      </article>
    </li>
  );
}

function Mark({ tone, icon }: { tone: 'brand' | 'success'; icon: typeof Tick02Icon }) {
  return (
    <IconTile tone={tone}>
      <Icon icon={icon} strokeWidth={tone === 'success' ? 2.4 : 2} />
    </IconTile>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13.5px] text-muted-foreground [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5">
      {children}
    </p>
  );
}

/** A draft: its completeness, Continue and Discard (spec 05 FE-9). */
export function DraftRow({ declaration }: { declaration: DeclarationListItem }) {
  const router = useRouter();
  const { toast } = useToast();
  const title = obligationTypeLabel(declaration.type, declaration.statementDate);
  return (
    <RowFrame
      mark={<Mark tone="brand" icon={PencilEdit02Icon} />}
      title={title}
      badge={<Badge variant="brand">{COPY.draft}</Badge>}
      bar={
        <>
          <Button asChild size="sm">
            <Link
              to="/declarations/$id"
              params={{ id: declaration.id }}
              aria-label={`${COPY.continue} ${title}`}
            >
              {COPY.continue}
              <Icon icon={ArrowRight01Icon} />
            </Link>
          </Button>
          <DiscardDraftButton
            declarationId={declaration.id}
            label={COPY.discard}
            srContext={title}
            onDiscarded={async () => {
              toast({ title: DISCARDED_TOAST });
              await router.invalidate();
            }}
          />
        </>
      }
    >
      <Facts>
        <span>{declaration.commission.name}</span>
        <span>{COPY.statementDate(declaration.statementDate)}</span>
        <span>{COPY.saved(declaration.updatedAt)}</span>
      </Facts>
      <div className="mt-3 flex max-w-[360px] items-center gap-3">
        <ProgressBar
          className="flex-1"
          label={`${title} progress`}
          value={declaration.completenessPercent}
          size="sm"
          showValue={false}
        />
        <span className="text-sm font-semibold tabular-nums">
          {COPY.percentComplete(declaration.completenessPercent)}
        </span>
      </div>
    </RowFrame>
  );
}

/** Downloads an issued slip through a short-lived link from the documents service. */
function useSlipDownload() {
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  async function download(documentId: string) {
    setPending(documentId);
    const link = await getMySlipDownload({ data: { documentId } }).catch(() => null);
    setPending(null);
    if (link?.status === 'ok') downloadFrom(link.downloadUrl);
    else toast({ title: COPY.slipDownloadFailed, urgency: 'assertive' });
  }
  return { pending, download };
}

type SlipDownload = ReturnType<typeof useSlipDownload>;
type SlipAcknowledgement = Pick<Acknowledgement, 'status' | 'documentId'>;

function SlipButton({
  version,
  acknowledgement: { status, documentId },
  slips,
  variant,
}: {
  version: number;
  acknowledgement: SlipAcknowledgement;
  slips: SlipDownload;
  variant: 'secondary' | 'ghost';
}) {
  if (status !== 'issued' || documentId === null) return null;
  const busy = slips.pending === documentId;
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={busy}
      aria-label={COPY.slipOf(version)}
      onClick={() => void slips.download(documentId)}
    >
      {busy ? <Spinner /> : <Icon icon={Download01Icon} />}
      {COPY.slip}
    </Button>
  );
}

/** The in-force version's slip, or why there is none yet. */
function CurrentSlip({
  declaration,
  slips,
}: {
  declaration: FiledDeclaration;
  slips: SlipDownload;
}) {
  const { acknowledgement } = declaration;
  if (acknowledgement.status === 'issued') {
    return (
      <SlipButton
        version={declaration.currentVersion}
        acknowledgement={acknowledgement}
        slips={slips}
        variant="secondary"
      />
    );
  }
  if (acknowledgement.status === 'failed') {
    // The success page asks for the slip again, with its cooldown.
    return (
      <Button asChild variant="secondary" size="sm">
        <Link to="/declarations/$id/submitted" params={{ id: declaration.id }}>
          <Icon icon={Download01Icon} />
          {COPY.slipFailed}
        </Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant="secondary" size="sm" disabled>
      <Icon icon={Download01Icon} />
      {COPY.slipPreparing}
    </Button>
  );
}

function Verified({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
      <Icon icon={ViewIcon} className="size-[13px]" />
      {COPY.verified(count)}
    </span>
  );
}

type VersionsLoad =
  { step: 'loading' } | { step: 'failed' } | { step: 'loaded'; versions: DeclarationVersion[] };

/** The declaration's versions, read when its row first expands (and again on Try again). */
function useVersions(declarationId: string) {
  const [load, setLoad] = useState<VersionsLoad | null>(null);
  async function fetchVersions() {
    setLoad({ step: 'loading' });
    const result = await getMyDeclarationVersions({ data: { declarationId } }).catch(() => null);
    if (result?.status === 'unauthenticated') {
      signInAgain();
      return;
    }
    setLoad(
      result?.status === 'ok' ? { step: 'loaded', versions: result.versions } : { step: 'failed' },
    );
  }
  return { load, fetchVersions };
}

function VersionList({
  title,
  load,
  onRetry,
  slips,
}: {
  title: string;
  load: VersionsLoad;
  onRetry: () => void;
  slips: SlipDownload;
}) {
  if (load.step === 'loading') {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={COPY.versionsLoading}
        className="grid gap-2.5 py-2.5"
      >
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-6 w-3/5" />
      </div>
    );
  }
  if (load.step === 'failed') {
    return (
      <Alert variant="destructive" className="my-2.5">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription className="grid justify-items-start gap-2">
          <p>{COPY.versionsFailed}</p>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <Icon icon={RefreshIcon} />
            {COPY.tryAgain}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <ul aria-label={COPY.versionsOf(title)}>
      {load.versions.map((version) => {
        const superseded = version.supersededAt !== null;
        return (
          <li
            key={version.version}
            className="flex flex-wrap items-center gap-3 border-b border-border py-2.5 text-sm last:border-b-0"
          >
            <VersionBadge
              version={version.version}
              className={superseded ? 'bg-muted text-muted-foreground' : undefined}
            />
            <span className="min-w-[160px] flex-1">
              {COPY.submittedAt(version.submittedAt)}
              {version.late ? ` · ${COPY.lateVersion}` : ''}
            </span>
            {superseded ? (
              <Badge>{COPY.superseded}</Badge>
            ) : (
              <Badge variant="success">{COPY.inForce}</Badge>
            )}
            <Verified count={version.acknowledgement.verifiedCount} />
            <SlipButton
              version={version.version}
              acknowledgement={version.acknowledgement}
              slips={slips}
              variant="ghost"
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A submitted declaration (spec 06 FE-4): reference, type, Commission, statement date, version,
 * when it was submitted, late, verified count and the slip; Amend until the due date, then
 * "Amendments closed"; Continue and Discard amendment while amending. Expands to every
 * version, older ones superseded, each with its slip.
 */
export function FiledRow({ declaration }: { declaration: FiledDeclaration }) {
  const router = useRouter();
  const { toast } = useToast();
  const slips = useSlipDownload();
  const versions = useVersions(declaration.id);
  const [expanded, setExpanded] = useState(false);
  const versionsId = useId();
  const title = obligationTypeLabel(declaration.type, declaration.statementDate);
  const amend = amendAvailability(declaration);

  function toggle() {
    if (!expanded && versions.load?.step !== 'loaded') void versions.fetchVersions();
    setExpanded(!expanded);
  }

  return (
    <RowFrame
      mark={<Mark tone="success" icon={Tick02Icon} />}
      title={title}
      badge={
        amend.kind === 'amending' ? (
          <Badge variant="info">{COPY.amending}</Badge>
        ) : (
          <Badge variant="success">{COPY.submitted}</Badge>
        )
      }
      bar={
        <>
          {amend.kind === 'amending' ? (
            <>
              <Button asChild size="sm">
                <Link
                  to="/declarations/$id"
                  params={{ id: declaration.id }}
                  aria-label={`${COPY.continueAmendment}: ${title}`}
                >
                  {COPY.continueAmendment}
                  <Icon icon={ArrowRight01Icon} />
                </Link>
              </Button>
              <DiscardAmendmentButton
                declarationId={declaration.id}
                fromVersion={amend.fromVersion}
                srContext={title}
                onDiscarded={async () => {
                  toast({ title: DISCARD_AMENDMENT_COPY.discarded(amend.fromVersion) });
                  await router.invalidate();
                }}
              />
            </>
          ) : (
            <>
              <CurrentSlip declaration={declaration} slips={slips} />
              {amend.kind === 'open' ? (
                <AmendButton
                  declarationId={declaration.id}
                  version={amend.version}
                  dueDate={amend.dueDate}
                  srContext={title}
                />
              ) : amend.kind === 'closed' ? (
                <span className="inline-flex items-center gap-1 px-1 text-[13px] text-muted-foreground">
                  <Icon icon={SquareLock01Icon} className="size-[13px]" />
                  {COPY.amendmentsClosed(amend.dueDate)}
                </span>
              ) : null}
            </>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Verified count={declaration.acknowledgement.verifiedCount} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              aria-controls={versionsId}
              onClick={toggle}
            >
              {COPY.versions(declaration.currentVersion)}
              <Icon icon={expanded ? ArrowUp01Icon : ArrowDown01Icon} />
            </Button>
          </span>
        </>
      }
      after={
        <div id={versionsId} hidden={!expanded} className="border-t border-border px-5 pt-1.5 pb-3">
          {expanded && versions.load ? (
            <VersionList
              title={title}
              load={versions.load}
              onRetry={() => void versions.fetchVersions()}
              slips={slips}
            />
          ) : null}
          {expanded && amend.kind === 'closed' ? (
            <p className="pt-2 text-[13px] text-muted-foreground">
              {COPY.closedNote(declaration.commission.name)}
            </p>
          ) : null}
        </div>
      }
    >
      <div className="mt-2">
        <ReferenceChip
          size="sm"
          reference={declaration.reference}
          parts={referenceParts(declaration.reference, declaration.commission.name)}
        />
      </div>
      <Facts>
        <span>
          <abbr title={declaration.commission.name} className="no-underline">
            {declaration.commission.issuerCode}
          </abbr>
        </span>
        <span>{COPY.statementDate(declaration.statementDate)}</span>
        <span>{COPY.submittedAt(declaration.submittedAt)}</span>
        <span>
          <VersionBadge version={declaration.currentVersion} />
        </span>
        {declaration.late ? (
          <span>
            <Badge variant="warning">
              <Icon icon={Clock01Icon} />
              {COPY.late}
            </Badge>
          </span>
        ) : null}
      </Facts>
    </RowFrame>
  );
}
