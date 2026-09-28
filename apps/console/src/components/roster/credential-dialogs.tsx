import {
  Alert,
  AlertTitle,
  Button,
  CardIcon,
  cn,
  DialogBody,
  DialogClose,
  DialogContent,
  type DialogContentProps,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  type IconProps,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Key01Icon,
  Loading03Icon,
  ArrowReloadHorizontalIcon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { messages as m } from './messages';

type Tone = 'neutral' | 'warning' | 'destructive';

const TILE: Record<Tone, string> = {
  neutral: '',
  warning: 'bg-warning-subtle text-warning',
  destructive: 'bg-destructive-subtle text-destructive',
};

/** The prototype's confirm dialog: icon tile and title, text, then Cancel and the action. */
function ConfirmDialogContent({
  icon,
  tone,
  title,
  children,
  error,
  cancelLabel,
  confirm,
  onCloseAutoFocus,
  busy = false,
}: {
  icon: IconProps['icon'];
  tone: Tone;
  title: string;
  children: ReactNode;
  /** Why the action failed, shown above the text so the dialog can be retried. */
  error?: string | null;
  cancelLabel: string;
  confirm: ReactNode;
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
  busy?: boolean;
}) {
  return (
    <DialogContent busy={busy} onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader className="flex-row items-center gap-3">
        <CardIcon className={cn('mb-0', TILE[tone])}>
          <Icon icon={icon} />
        </CardIcon>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody className="gap-3">
        {error ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : null}
        <DialogDescription asChild>
          <div className="grid gap-2 text-[15px] text-secondary-foreground">{children}</div>
        </DialogDescription>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {cancelLabel}
          </Button>
        </DialogClose>
        {confirm}
      </DialogFooter>
    </DialogContent>
  );
}

function ActionButton({
  variant,
  busy,
  label,
  busyLabel,
  onClick,
}: {
  variant: 'default' | 'destructive';
  busy: boolean;
  label: string;
  busyLabel: string;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant={variant} disabled={busy} onClick={onClick}>
      {busy ? (
        <>
          <Icon icon={Loading03Icon} className="animate-spin" />
          {busyLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

interface ActionDialogProps {
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
}

/** "Rotate secret?": the current secret stops working as soon as the new one is issued. */
export function RotateDialogContent({
  busy,
  error,
  onConfirm,
  onCloseAutoFocus,
}: ActionDialogProps) {
  return (
    <ConfirmDialogContent
      icon={ArrowReloadHorizontalIcon}
      tone="neutral"
      title={m.apiRotateTitle}
      error={error}
      busy={busy}
      cancelLabel={m.apiCancel}
      onCloseAutoFocus={onCloseAutoFocus}
      confirm={
        <ActionButton
          variant="default"
          busy={busy}
          label={m.apiRotate}
          busyLabel={m.apiRotating}
          onClick={onConfirm}
        />
      }
    >
      <p>{m.apiRotateText}</p>
    </ConfirmDialogContent>
  );
}

/** "Revoke API access?" (destructive): the HR system loses access immediately. */
export function RevokeDialogContent({
  busy,
  error,
  onConfirm,
  onCloseAutoFocus,
}: ActionDialogProps) {
  return (
    <ConfirmDialogContent
      icon={UnavailableIcon}
      tone="destructive"
      title={m.apiRevokeTitle}
      error={error}
      busy={busy}
      cancelLabel={m.apiCancel}
      onCloseAutoFocus={onCloseAutoFocus}
      confirm={
        <ActionButton
          variant="destructive"
          busy={busy}
          label={m.apiRevoke}
          busyLabel={m.apiRevoking}
          onClick={onConfirm}
        />
      }
    >
      <p>{m.apiRevokeText}</p>
      <p className="text-sm text-muted-foreground">{m.apiRevokeHistory}</p>
    </ConfirmDialogContent>
  );
}

/**
 * "Have you saved the secret?", before the secret leaves the screen for good: on Done, and when
 * leaving the page while it is shown.
 */
export function SavedDialogContent({
  onConfirm,
  onCloseAutoFocus,
}: {
  onConfirm: () => void;
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
}) {
  return (
    <ConfirmDialogContent
      icon={Key01Icon}
      tone="warning"
      title={m.apiSavedTitle}
      cancelLabel={m.apiSavedBack}
      onCloseAutoFocus={onCloseAutoFocus}
      confirm={
        <Button type="button" onClick={onConfirm}>
          {m.apiSavedConfirm}
        </Button>
      }
    >
      <p>{m.apiSavedText}</p>
    </ConfirmDialogContent>
  );
}
