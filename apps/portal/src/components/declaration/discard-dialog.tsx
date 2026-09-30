import {
  Alert,
  AlertDescription,
  Button,
  type ButtonProps,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Icon,
} from '@adili/ui';
import { AlertCircleIcon, Delete02Icon } from '@hugeicons/core-free-icons';

import { discardMyDeclaration } from '../../server/declarations';
import { useConfirmAction } from '../confirm-action';

export const DISCARD_TITLE = 'Discard this draft?';
export const DISCARD_BODY = 'Everything you entered will be deleted.';
export const DISCARDED_TOAST = 'Draft discarded';

const FAILED = {
  'not-draft': 'This declaration is no longer a draft, so it cannot be discarded.',
  unavailable: 'We could not discard your draft. Try again in a few minutes.',
} as const;

export interface DiscardDraftButtonProps {
  declarationId: string;
  /** The trigger's text, e.g. "Discard draft" or "Discard". */
  label?: string;
  /** Names what is discarded for screen readers, e.g. "Biennial declaration". */
  srContext?: string;
  size?: ButtonProps['size'];
  /** Called once the draft is gone (a draft already gone counts). */
  onDiscarded: () => void | Promise<void>;
}

/**
 * "Discard draft" and its confirmation (FE-8, S15): deletes the draft for good; the
 * obligation stays open, so a new start creates a fresh draft.
 */
export function DiscardDraftButton({
  declarationId,
  label = 'Discard draft',
  srContext,
  size = 'sm',
  onDiscarded,
}: DiscardDraftButtonProps) {
  const { open, setOpen, busy, problem, run } = useConfirmAction<keyof typeof FAILED>({
    unavailable: 'unavailable',
    action: async () => {
      const result = await discardMyDeclaration({ data: { declarationId } });
      if (result.status === 'discarded' || result.status === 'not-found') {
        await onDiscarded();
        return { status: 'done' };
      }
      if (result.status === 'unauthenticated') return result;
      return { status: 'problem', problem: result.status };
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="destructive-ghost"
          size={size}
          aria-label={srContext ? `${label} ${srContext}` : undefined}
        >
          <Icon icon={Delete02Icon} />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>{DISCARD_TITLE}</DialogTitle>
          <DialogDescription>{DISCARD_BODY}</DialogDescription>
        </DialogHeader>
        {problem ? (
          <DialogBody>
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>{FAILED[problem]}</AlertDescription>
            </Alert>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setOpen(false);
            }}
          >
            Keep draft
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void run()}>
            Discard draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
