import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  Icon,
  IconTile,
  type IconProps,
  RadioCard,
  RadioGroup,
  Skeleton,
  Spinner,
} from '@adili/ui';
import {
  Alert02Icon,
  ArrowLeftRightIcon,
  RefreshIcon,
  Undo02Icon,
  UserCheck01Icon,
  UserMultiple02Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useState } from 'react';

import { CASE_COPY, REGISTRY_COPY } from '../../../review-case/messages';
import type { Reviewer } from '../../../server/review-case.server';
import type { ServiceResult } from '../../../server/service-call';

/**
 * The assignment dialogs of the case view (spec 07a FE-3): a supervisor's Claim (they become a
 * reviewer of record), Release, Unassign, and Reassign with the Commission's reviewers. Each runs
 * `onConfirm`, which resolves to an error to show or null when done (the host closes it).
 */

function Header({
  icon,
  title,
  description,
}: {
  icon: IconProps['icon'];
  title: string;
  description?: ReactNode;
}) {
  return (
    <DialogHeader className="flex-row items-start gap-3">
      <IconTile>
        <Icon icon={icon} />
      </IconTile>
      <div className="grid min-w-0 gap-[3px]">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </div>
    </DialogHeader>
  );
}

function useConfirm(onConfirm: () => Promise<string | null>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    reset: () => {
      setError(null);
    },
    run: async () => {
      setBusy(true);
      setError(null);
      const failed = await onConfirm();
      setBusy(false);
      setError(failed);
    },
  };
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<string | null>;
}

function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  icon,
  title,
  body,
  callout,
  cancel,
  confirm,
}: ConfirmProps & {
  icon: IconProps['icon'];
  title: string;
  body: ReactNode;
  callout?: ReactNode;
  cancel: string;
  confirm: string;
}) {
  const state = useConfirm(onConfirm);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) state.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy}>
        <Header icon={icon} title={title} />
        <DialogBody className="gap-3.5">
          <DialogDescription className="text-[15px] text-foreground">{body}</DialogDescription>
          {callout}
          {state.error ? <FieldError>{state.error}</FieldError> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{cancel}</Button>
          </DialogClose>
          <Button disabled={state.busy} onClick={() => void state.run()}>
            {state.busy ? <Spinner /> : null}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A supervisor claiming a case becomes a reviewer of record, so they are told first. */
export function ClaimDialog({
  reference,
  name,
  ...props
}: ConfirmProps & { reference: string; name: string }) {
  const copy = CASE_COPY.claimDialog;
  return (
    <ConfirmDialog
      {...props}
      icon={UserCheck01Icon}
      title={copy.title}
      body={copy.body(reference, name)}
      callout={
        <Alert variant="warning" role="note">
          <Icon icon={UserMultiple02Icon} />
          <AlertDescription>{copy.separation}</AlertDescription>
        </Alert>
      }
      cancel={CASE_COPY.cancel}
      confirm={copy.confirm}
    />
  );
}

export function ReleaseDialog({ reference, ...props }: ConfirmProps & { reference: string }) {
  const copy = CASE_COPY.releaseDialog;
  return (
    <ConfirmDialog
      {...props}
      icon={Undo02Icon}
      title={copy.title}
      body={copy.body(reference)}
      cancel={copy.keep}
      confirm={copy.confirm}
    />
  );
}

export function UnassignDialog({
  reference,
  holder,
  ...props
}: ConfirmProps & { reference: string; holder: string }) {
  const copy = CASE_COPY.unassignDialog;
  return (
    <ConfirmDialog
      {...props}
      icon={UserRemove01Icon}
      title={copy.title}
      body={copy.body(reference, holder)}
      cancel={CASE_COPY.cancel}
      confirm={copy.confirm}
    />
  );
}

/**
 * Re-check the case's registries (spec 07b): the lookups run again in the background; reviewed
 * flags keep their notes and indicators that no longer apply are closed.
 */
export function RecheckDialog(props: ConfirmProps) {
  const copy = REGISTRY_COPY.recheck;
  return (
    <ConfirmDialog
      {...props}
      icon={RefreshIcon}
      title={copy.title}
      body={copy.body}
      callout={<p className="text-[13px] text-muted-foreground">{copy.note}</p>}
      cancel={CASE_COPY.cancel}
      confirm={copy.confirm}
    />
  );
}

/**
 * Reassign (or, with nobody holding the case, Assign): the Commission's reviewers as radio cards,
 * each with the cases they hold and whether they held this one, the current holder left out.
 * Give it a new `key` each time it opens, so it starts afresh.
 */
export function ReassignDialog({
  open,
  onOpenChange,
  reference,
  declarantName,
  holder,
  self,
  loadReviewers,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string;
  declarantName: string;
  /** The reviewer holding the case; null when nobody does. */
  holder: string | null;
  /** The signed-in supervisor's subject, to say "You". */
  self: string;
  loadReviewers: () => Promise<ServiceResult<Reviewer[]>>;
  onConfirm: (reviewer: Reviewer) => Promise<string | null>;
}) {
  const copy = CASE_COPY.reassignDialog;
  const [reviewers, setReviewers] = useState<Reviewer[] | 'loading' | 'failed'>('loading');
  const [picked, setPicked] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const chosen = Array.isArray(reviewers)
    ? (reviewers.find((each) => each.subject === picked) ?? null)
    : null;
  const state = useConfirm(() => (chosen ? onConfirm(chosen) : Promise.resolve(null)));

  async function load() {
    setReviewers('loading');
    const result = await loadReviewers();
    setReviewers(result.ok ? result.data : 'failed');
  }

  // The host remounts the dialog each time it opens (`key`), so this loads once per opening.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadReviewers().then((result) => {
      if (live) setReviewers(result.ok ? result.data : 'failed');
    });
    return () => {
      live = false;
    };
    // `loadReviewers` is a new function on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  let body: ReactNode;
  if (reviewers === 'loading') {
    body = (
      <div className="grid gap-2" aria-label={copy.loading} role="status">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-[58px] rounded-lg" />
        ))}
      </div>
    );
  } else if (reviewers === 'failed') {
    body = (
      <Alert variant="destructive">
        <Icon icon={Alert02Icon} />
        <AlertTitle>{copy.failed}</AlertTitle>
        <AlertDescription>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void load()}>
            {CASE_COPY.retry}
          </Button>
        </AlertDescription>
      </Alert>
    );
  } else if (reviewers.length === 0) {
    body = <p className="text-sm text-muted-foreground">{copy.none}</p>;
  } else {
    body = (
      <RadioGroup legend={copy.assignTo} error={missing ? copy.pick : undefined}>
        {reviewers.map((reviewer) => (
          <RadioCard
            key={reviewer.subject}
            name="assignee"
            value={reviewer.subject}
            checked={picked === reviewer.subject}
            onChange={() => {
              setPicked(reviewer.subject);
              setMissing(false);
            }}
            label={
              <span className="flex items-center gap-2.5">
                <Avatar name={reviewer.name} current={reviewer.subject === self} />
                <span>
                  {reviewer.name}
                  {reviewer.subject === self ? (
                    <span className="font-normal text-muted-foreground"> {copy.you}</span>
                  ) : null}
                </span>
              </span>
            }
            description={[copy.load(reviewer.open), reviewer.ofRecord ? copy.ofRecord : null]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </RadioGroup>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) state.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy}>
        <Header
          icon={ArrowLeftRightIcon}
          title={copy.title(holder !== null)}
          description={`${reference} · ${declarantName}`}
        />
        <DialogBody className="gap-3.5">
          {holder ? <p className="text-sm text-muted-foreground">{copy.heldBy(holder)}</p> : null}
          {body}
          {Array.isArray(reviewers) && reviewers.length > 0 ? (
            <p className="text-[13px] text-muted-foreground">{copy.hint}</p>
          ) : null}
          {state.error ? <FieldError>{state.error}</FieldError> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{CASE_COPY.cancel}</Button>
          </DialogClose>
          <Button
            disabled={state.busy || !Array.isArray(reviewers) || reviewers.length === 0}
            onClick={() => {
              if (!chosen) {
                setMissing(true);
                return;
              }
              void state.run();
            }}
          >
            {state.busy ? <Spinner /> : null}
            {copy.confirm(holder !== null)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
