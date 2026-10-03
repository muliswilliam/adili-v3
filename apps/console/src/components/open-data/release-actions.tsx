import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  FieldHint,
  Icon,
  type IconProps,
  IconTile,
  Label,
  Spinner,
  Textarea,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  BanIcon,
  Download04Icon,
  GlobeIcon,
  RefreshIcon,
  SecurityCheckIcon,
  SquareLock02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';

import type { OpenDataReleaseView, ReleasesResult } from '../../server/open-data-releases.server';
import type { OpenDataRelease } from '../../server/reporting/types';
import { messages as m, mismatchLabel } from './messages';
import { isProblem, mayBeRecorded, type ReleasesFailure } from './problems';
import { releaseName } from './release-parts';

type Result = ReleasesResult<OpenDataRelease>;
type Failure = ReleasesFailure;

export interface ReleaseActionsProps {
  view: OpenDataReleaseView;
  /** Whether the viewer is an EACC supervisor: only they publish and withdraw. */
  supervisor: boolean;
  publish: (releaseId: string, idempotencyKey: string) => Promise<Result>;
  withdraw: (releaseId: string, reason: string, idempotencyKey: string) => Promise<Result>;
  rebuild: (fy: number, kind: OpenDataRelease['kind'], idempotencyKey: string) => Promise<Result>;
  /** Opens the version just built. */
  onRebuilt: (release: OpenDataRelease) => void;
  onUnauthenticated: () => void;
}

/**
 * The release page's header actions (spec 09b FE-3, S6, S7, #353). An EACC supervisor publishes
 * a preview ("This will be public immediately.") and withdraws a published release with a
 * required, public reason; anyone in EACC builds the next version of the latest withdrawn one.
 *
 * Each action keeps its Idempotency-Key until it has an answer: a retry after no answer, or after
 * the dialog was closed and opened again, sends the same key, so the service replays what it did
 * rather than acting twice. A refusal (4xx, other than a key still in use) ends the key.
 */
export function ReleaseActions(props: ReleaseActionsProps) {
  const { view, supervisor } = props;
  const { release, versions } = view;
  const [open, setOpen] = useState<'publish' | 'withdraw' | null>(null);
  const publishKey = usePendingKey();
  const withdrawKey = usePendingKey();
  // The latest version of its year and kind: a withdrawn one with a newer version is replaced.
  const canRebuild = release.status === 'withdrawn' && versions?.[0]?.id === release.id;
  return (
    <>
      {release.status === 'preview' && supervisor ? (
        <Button
          onClick={() => {
            setOpen('publish');
          }}
        >
          <Icon icon={GlobeIcon} />
          {m.publish}
        </Button>
      ) : null}
      {release.status === 'published' && supervisor ? (
        <Button
          variant="destructive-ghost"
          onClick={() => {
            setOpen('withdraw');
          }}
        >
          <Icon icon={BanIcon} />
          {m.withdraw}
        </Button>
      ) : null}
      {canRebuild ? <RebuildButton {...props} /> : null}
      {open === 'publish' ? (
        <PublishDialog
          {...props}
          idempotencyKey={publishKey}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
      {open === 'withdraw' ? (
        <WithdrawDialog
          {...props}
          idempotencyKey={withdrawKey}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

interface PendingKey {
  /** The key of the action in flight or without an answer yet. */
  current: () => string;
  /** The action has its answer: the next one gets a new key. */
  settle: () => void;
}

function usePendingKey(): PendingKey {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return {
    current: () => key,
    settle: () => {
      setKey(crypto.randomUUID());
    },
  };
}

/** How a dialog's action ended, when it did not succeed. */
type Ending =
  /** Say why in the dialog. */
  | { kind: 'error'; message: string }
  /** The release changed meanwhile: close, reload and say so. */
  | { kind: 'reload'; message: string }
  | { kind: 'unauthenticated' };

function common(failure: Failure): Ending | null {
  const { error } = failure;
  if (error.kind === 'unauthenticated') return { kind: 'unauthenticated' };
  if (error.kind !== 'problem') return null;
  if (isProblem(error.problem, 'idempotency-key-in-use')) {
    return { kind: 'error', message: m.stillProcessing };
  }
  // The key was sent before with another reason: that earlier request was recorded.
  if (isProblem(error.problem, 'idempotency-key-reused')) {
    return { kind: 'reload', message: m.earlierRequestRecorded };
  }
  if (error.problem.status === 404) return { kind: 'error', message: m.releaseGone };
  return null;
}

function publishEnding(failure: Failure, release: OpenDataRelease): Ending {
  const known = common(failure);
  if (known) return known;
  const { error } = failure;
  if (error.kind === 'problem') {
    const { status, code } = error.problem;
    if (status === 403) return { kind: 'error', message: m.publishForbidden };
    if (code === 'release-not-preview') return { kind: 'reload', message: m.notPreviewAnymore };
    if (code === 'annual-release-published') {
      return { kind: 'error', message: m.annualReleasePublished(release.fy) };
    }
  }
  if (error.kind === 'unavailable') {
    if (error.problemType === 'manifest-refused') {
      return { kind: 'error', message: m.manifestRefused };
    }
    if (error.problemType === 'documents-unavailable') {
      return { kind: 'error', message: m.publishDocumentsUnavailable };
    }
    if (error.problemType === 'storage-unavailable') {
      return { kind: 'error', message: m.publishStorageUnavailable };
    }
  }
  return { kind: 'error', message: m.publishFailed };
}

function withdrawEnding(failure: Failure): Ending {
  const known = common(failure);
  if (known) return known;
  const { error } = failure;
  if (error.kind === 'problem') {
    const { status, code } = error.problem;
    if (status === 403) return { kind: 'error', message: m.withdrawForbidden };
    if (status === 400) return { kind: 'error', message: m.reasonInvalid };
    if (code === 'release-not-published') {
      return { kind: 'reload', message: m.notPublishedAnymore };
    }
  }
  if (error.kind === 'unavailable') {
    if (error.problemType === 'manifest-revocation-refused') {
      return { kind: 'error', message: m.revocationRefused };
    }
    if (error.problemType === 'documents-unavailable') {
      return { kind: 'error', message: m.withdrawDocumentsUnavailable };
    }
  }
  return { kind: 'error', message: m.withdrawFailed };
}

/**
 * Runs a dialog's action: on success closes, says so and reloads; otherwise keeps the key while
 * the outcome is unknown and ends as `ending` says.
 */
function useAction({
  idempotencyKey,
  onClose,
  onUnauthenticated,
}: {
  idempotencyKey: PendingKey;
  onClose: () => void;
  onUnauthenticated: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    call: (key: string) => Promise<Result>,
    done: string,
    ending: (failure: Failure) => Ending,
  ) => {
    setBusy(true);
    setError(null);
    const result = await call(idempotencyKey.current());
    setBusy(false);
    if (result.ok) {
      idempotencyKey.settle();
      onClose();
      toast({ title: done });
      await router.invalidate();
      return;
    }
    if (!mayBeRecorded(result)) idempotencyKey.settle();
    const end = ending(result);
    if (end.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    if (end.kind === 'reload') {
      onClose();
      toast({ title: end.message });
      await router.invalidate();
      return;
    }
    setError(end.message);
  };
  return { busy, error, setError, run };
}

function PublishDialog({
  view,
  publish,
  idempotencyKey,
  onClose,
  onUnauthenticated,
}: ReleaseActionsProps & { idempotencyKey: PendingKey; onClose: () => void }) {
  const { release } = view;
  const action = useAction({ idempotencyKey, onClose, onUnauthenticated });
  const confirm = () =>
    action.run(
      (key) => publish(release.id, key),
      m.publishedToast,
      (failure) => publishEnding(failure, release),
    );
  return (
    <ActionDialog
      title={m.publishTitle(releaseName(release))}
      icon={GlobeIcon}
      tone="brand"
      busy={action.busy}
      busyTitle={m.publishing}
      busyText={m.publishingText}
      error={action.error}
      onClose={onClose}
      confirm={
        <Button
          type="button"
          disabled={action.busy}
          onClick={() => {
            void confirm();
          }}
        >
          <Icon icon={GlobeIcon} />
          {m.publish}
        </Button>
      }
    >
      <Alert variant="warning" role="note">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>
          <b>{m.publishWarning}</b>
        </AlertDescription>
      </Alert>
      <Consequences
        items={[
          [GlobeIcon, m.publishConsequences[0]],
          [SecurityCheckIcon, m.publishConsequences[1]],
          [SquareLock02Icon, m.publishConsequences[2]],
        ]}
      />
    </ActionDialog>
  );
}

type IconSvg = IconProps['icon'];

const REASON_MAX = 1000;

function WithdrawDialog({
  view,
  withdraw,
  idempotencyKey,
  onClose,
  onUnauthenticated,
}: ReleaseActionsProps & { idempotencyKey: PendingKey; onClose: () => void }) {
  const { release } = view;
  const fieldId = useId();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const action = useAction({ idempotencyKey, onClose, onUnauthenticated });
  const confirm = () => {
    if (!reason.trim()) {
      setReasonError(m.reasonRequired);
      document.getElementById(fieldId)?.focus();
      return;
    }
    void action.run(
      (key) => withdraw(release.id, reason.trim(), key),
      m.withdrawnToast,
      withdrawEnding,
    );
  };
  return (
    <ActionDialog
      title={m.withdrawTitle(releaseName(release))}
      icon={BanIcon}
      tone="destructive"
      busy={action.busy}
      busyTitle={m.withdrawing}
      error={action.error}
      onClose={onClose}
      confirm={
        <Button type="button" variant="destructive" disabled={action.busy} onClick={confirm}>
          <Icon icon={BanIcon} />
          {m.withdraw}
        </Button>
      }
    >
      <Consequences
        items={[
          [ViewIcon, m.withdrawConsequences[0]],
          [Download04Icon, m.withdrawConsequences[1]],
          [RefreshIcon, m.withdrawConsequences[2]],
        ]}
      />
      <div className="grid gap-1.5">
        <Label htmlFor={fieldId}>{m.reason}</Label>
        <Textarea
          id={fieldId}
          rows={4}
          maxLength={REASON_MAX}
          value={reason}
          placeholder={m.reasonPlaceholder}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={`${fieldId}-help`}
          onChange={(event) => {
            setReason(event.target.value);
            setReasonError(null);
          }}
        />
        {reasonError ? (
          <FieldError id={`${fieldId}-help`}>{reasonError}</FieldError>
        ) : (
          <FieldHint id={`${fieldId}-help`}>{m.reasonHint(reason.length)}</FieldHint>
        )}
      </div>
    </ActionDialog>
  );
}

function ActionDialog({
  title,
  icon,
  tone,
  busy,
  busyTitle,
  busyText,
  error,
  onClose,
  confirm,
  children,
}: {
  title: string;
  icon: IconSvg;
  tone: 'brand' | 'destructive';
  busy: boolean;
  busyTitle: string;
  busyText?: string;
  error: string | null;
  onClose: () => void;
  confirm: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent busy={busy} aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile tone={tone}>
            <Icon icon={icon} />
          </IconTile>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {busy ? (
            <div role="status" className="flex flex-col items-center py-6 text-center">
              <Spinner className="mb-3.5 size-7" />
              <p className="text-[15px] font-semibold">{busyTitle}</p>
              {busyText ? <p className="mt-1 text-sm text-muted-foreground">{busyText}</p> : null}
            </div>
          ) : (
            children
          )}
          {error && !busy ? (
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        {busy ? null : (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {m.cancel}
            </Button>
            {confirm}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The prototype's `.conseq` list: what the action does, one icon and line each. */
function Consequences({ items }: { items: [IconSvg, string][] }) {
  return (
    <ul className="grid gap-2.5 text-[14px]">
      {items.map(([icon, text]) => (
        <li key={text} className="flex items-start gap-2.5">
          <Icon icon={icon} className="mt-[3px] size-[15px] shrink-0 text-secondary-foreground" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Build v{n+1}: the next version of the latest withdrawn release, of its kind, as a preview; opens
 * it. A preview is not public, so it needs no confirmation.
 */
function RebuildButton({ view, rebuild, onRebuilt, onUnauthenticated }: ReleaseActionsProps) {
  const { release } = view;
  const { toast } = useToast();
  const key = usePendingKey();
  const [busy, setBusy] = useState(false);
  const next = release.version + 1;
  const run = async () => {
    setBusy(true);
    const result = await rebuild(release.fy, release.kind, key.current());
    setBusy(false);
    if (result.ok) {
      key.settle();
      toast({ title: m.rebuiltToast(result.data.version) });
      onRebuilt(result.data);
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    if (!mayBeRecorded(result)) key.settle();
    toast({
      title: m.rebuildStopped(next),
      description: rebuildFailure(result),
      urgency: 'assertive',
    });
  };
  return (
    <Button
      variant="secondary"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => {
        void run();
      }}
    >
      {busy ? <Spinner /> : <Icon icon={RefreshIcon} />}
      {m.rebuild(next)}
    </Button>
  );
}

function rebuildFailure(failure: Failure): string {
  const { error } = failure;
  if (error.kind === 'problem') {
    const { code, mismatches } = error.problem;
    if (code === 'reconciliation-failed') {
      return m.reconciliationFailed((mismatches ?? []).map(mismatchLabel).join(', '));
    }
    if (code === 'fy-not-started') return m.fyNotStarted;
    if (code === 'ncr-not-built') return m.ncrNotBuilt;
    if (code === 'ncr-not-approved') return m.ncrNotApproved;
    if (code === 'annual-release-published') return m.annualStillPublished;
    if (isProblem(error.problem, 'idempotency-key-in-use')) return m.stillProcessing;
  }
  if (error.kind === 'unavailable' && error.problemType === 'storage-unavailable') {
    return m.storageUnavailable;
  }
  if (error.kind === 'unavailable' && error.problemType === 'directory-unavailable') {
    return m.directoryUnavailable;
  }
  return m.rebuildFailed;
}
