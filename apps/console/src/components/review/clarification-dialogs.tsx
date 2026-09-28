import {
  Alert,
  AlertDescription,
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
  FieldHint,
  Icon,
  Label,
  Spinner,
  Textarea,
} from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import { resolveNoteError, resolveOutcome, withdrawReasonError } from '../../clarification/dialogs';

/**
 * Mark resolved and Withdraw (spec 07a S15), as controlled dialogs. Each checks its text, then
 * hands it to `onSubmit`, which resolves to an error to show in the dialog or null when done.
 */

interface TextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string | null;
  onSubmit: (text: string) => Promise<string | null>;
}

function useTextDialog(
  onSubmit: (text: string) => Promise<string | null>,
  check: (text: string) => string | null,
) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    text,
    error,
    busy,
    change: (value: string) => {
      setText(value);
      if (error) setError(null);
    },
    reset: () => {
      setText('');
      setError(null);
    },
    submit: async () => {
      const problem = check(text);
      if (problem) {
        setError(problem);
        return;
      }
      setBusy(true);
      const failed = await onSubmit(text.trim());
      setBusy(false);
      setError(failed);
    },
  };
}

export function ResolveDialog({
  open,
  onOpenChange,
  reference,
  othersOpen,
  onSubmit,
}: TextDialogProps & { othersOpen: number }) {
  const state = useTextDialog(onSubmit, resolveNoteError);
  const fieldId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) state.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy}>
        <DialogHeader>
          <DialogTitle>Mark clarification resolved</DialogTitle>
          <DialogDescription className="font-mono">{reference}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>Resolution note</Label>
            <Textarea
              id={fieldId}
              rows={4}
              value={state.text}
              placeholder="What did the response show? Is anything left open?"
              aria-invalid={state.error ? true : undefined}
              aria-describedby={`${fieldId}-help`}
              onChange={(event) => {
                state.change(event.target.value);
              }}
            />
            {state.error ? (
              <FieldError id={`${fieldId}-help`}>{state.error}</FieldError>
            ) : (
              <FieldHint id={`${fieldId}-help`}>The declarant does not see this note.</FieldHint>
            )}
          </div>
          <Alert variant="info" role="note">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{resolveOutcome(othersOpen)}</AlertDescription>
          </Alert>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button disabled={state.busy} onClick={() => void state.submit()}>
            {state.busy ? <Spinner /> : null}
            Mark resolved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawDialog({ open, onOpenChange, reference, onSubmit }: TextDialogProps) {
  const state = useTextDialog(onSubmit, withdrawReasonError);
  const fieldId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) state.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy}>
        <DialogHeader>
          <DialogTitle>Withdraw this clarification?</DialogTitle>
          <DialogDescription className="font-mono">{reference}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <p>Withdraw only if it was issued in error. This cannot be undone.</p>
          <ul className="grid list-disc gap-1 pl-5 text-sm text-secondary-foreground">
            <li>
              The letter is revoked as issued in error. Anyone who scans its QR code sees that it
              was withdrawn.
            </li>
            <li>The declarant sees it as withdrawn in the portal and does not need to respond.</li>
            <li>The reminder and overdue steps stop.</li>
            <li>
              The reference number is kept with a withdrawn status, so the register has no gaps.
            </li>
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>Reason</Label>
            <Textarea
              id={fieldId}
              rows={3}
              value={state.text}
              placeholder="For example: issued against the wrong item"
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? `${fieldId}-error` : undefined}
              onChange={(event) => {
                state.change(event.target.value);
              }}
            />
            {state.error ? <FieldError id={`${fieldId}-error`}>{state.error}</FieldError> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Keep it</Button>
          </DialogClose>
          <Button variant="destructive" disabled={state.busy} onClick={() => void state.submit()}>
            {state.busy ? <Spinner /> : null}
            Withdraw clarification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
