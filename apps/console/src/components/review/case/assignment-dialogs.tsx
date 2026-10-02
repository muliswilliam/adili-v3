import {
  Alert,
  AlertDescription,
  AssigneeAvatar,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldHint,
  Icon,
  RadioCard,
  RadioGroup,
  Spinner,
} from '@adili/ui';
import { UserMultipleIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useState } from 'react';

import type { Assignee } from '../../../server/review/types';
import { messages as t } from './messages';

/**
 * The confirmations behind the case header's actions (spec 07a FE-3, S8): claim (a supervisor is
 * told they become a reviewer of record), release, unassign, and the reassign dialog with the
 * reviewers a supervisor can hand the case to. Each `onConfirm` resolves when the call is done;
 * the header closes the dialog and says how it went.
 */

export type AssignmentDialog =
  { kind: 'claim' } | { kind: 'release' } | { kind: 'unassign' } | { kind: 'reassign' };

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  cancel = t.dialogs.cancel,
  confirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  cancel?: string;
  confirm: string;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody className="text-[14.5px]">{children}</DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{cancel}</Button>
          </DialogClose>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => {
                setBusy(false);
              });
            }}
          >
            {busy ? <Spinner className="size-4" /> : null}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClaimDialog({
  open,
  onOpenChange,
  reference,
  declarant,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string;
  declarant: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.dialogs.claimTitle}
      confirm={t.dialogs.claimConfirm}
      onConfirm={onConfirm}
    >
      <p>{t.dialogs.claimBody(reference, declarant)}</p>
      <Alert variant="warning" role="note">
        <Icon icon={UserMultipleIcon} />
        <AlertDescription>{t.dialogs.claimSupervisor}</AlertDescription>
      </Alert>
    </ConfirmDialog>
  );
}

export function ReleaseDialog({
  open,
  onOpenChange,
  reference,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.dialogs.releaseTitle}
      cancel={t.dialogs.releaseKeep}
      confirm={t.dialogs.releaseConfirm}
      onConfirm={onConfirm}
    >
      <p>{t.dialogs.releaseBody(reference)}</p>
    </ConfirmDialog>
  );
}

export function UnassignDialog({
  open,
  onOpenChange,
  reference,
  holder,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string;
  holder: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.dialogs.unassignTitle}
      confirm={t.actions.unassign}
      onConfirm={onConfirm}
    >
      <p>{t.dialogs.unassignBody(reference, holder)}</p>
    </ConfirmDialog>
  );
}

export function ReassignDialog({
  open,
  onOpenChange,
  reference,
  declarant,
  holder,
  reviewers,
  viewerSubject,
  reviewersOfRecord,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string;
  declarant: string;
  holder: Assignee | null;
  reviewers: Assignee[];
  viewerSubject: string;
  reviewersOfRecord: Assignee[];
  onConfirm: (reviewer: Assignee) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string | null>(reviewers[0]?.subject ?? null);
  const [busy, setBusy] = useState(false);
  const reviewer = reviewers.find((each) => each.subject === picked) ?? null;
  const verb = holder ? t.actions.reassign : 'Assign';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPicked(reviewers[0]?.subject ?? null);
        onOpenChange(next);
      }}
    >
      <DialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>{holder ? t.dialogs.reassignTitle : t.dialogs.assignTitle}</DialogTitle>
          <DialogDescription>
            {reference} · {declarant}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {holder ? (
            <p className="-mt-1 text-sm text-muted-foreground">
              {t.dialogs.currentlyHeld(holder.name)}
            </p>
          ) : null}
          {reviewers.length > 0 ? (
            <RadioGroup legend={t.dialogs.assignTo}>
              {reviewers.map((each) => {
                const ofRecord = reviewersOfRecord.some((known) => known.subject === each.subject);
                const you = each.subject === viewerSubject;
                return (
                  <RadioCard
                    key={each.subject}
                    name="assignee"
                    value={each.subject}
                    checked={picked === each.subject}
                    onChange={() => {
                      setPicked(each.subject);
                    }}
                    label={
                      <span className="flex items-center gap-2.5">
                        <AssigneeAvatar name={each.name} me={you} />
                        <span>
                          {each.name}
                          {you ? (
                            <span className="font-normal text-muted-foreground">
                              {' '}
                              ({t.dialogs.you.toLowerCase()})
                            </span>
                          ) : null}
                        </span>
                      </span>
                    }
                    description={ofRecord ? t.dialogs.ofRecord : undefined}
                  />
                );
              })}
            </RadioGroup>
          ) : (
            <p className="text-sm text-muted-foreground">{t.dialogs.noReviewers}</p>
          )}
          <FieldHint className="-mt-2">{t.dialogs.reviewerOfRecordNote}</FieldHint>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t.dialogs.cancel}</Button>
          </DialogClose>
          <Button
            disabled={busy || !reviewer}
            onClick={() => {
              if (!reviewer) return;
              setBusy(true);
              void onConfirm(reviewer).finally(() => {
                setBusy(false);
              });
            }}
          >
            {busy ? <Spinner className="size-4" /> : null}
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
