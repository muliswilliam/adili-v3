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
  IconTile,
} from '@adili/ui';
import { AlertCircleIcon, Delete02Icon, Undo02Icon } from '@hugeicons/core-free-icons';

import { discardMyAmendment } from '../../server/declarations';
import { useConfirmAction } from '../confirm-action';

export const DISCARD_AMENDMENT_COPY = {
  trigger: 'Discard amendment',
  title: 'Discard this amendment?',
  body: (version: number) =>
    `Your changes will be deleted. Version ${String(version)} stays in force, unchanged.`,
  keep: 'Keep amending',
  confirm: 'Discard amendment',
  discarded: (version: number) => `Amendment discarded. Version ${String(version)} is unchanged.`,
  notAmending: 'This declaration is no longer being amended. Reload to see where it stands.',
  unavailable: 'We could not discard the amendment. Try again in a few minutes.',
} as const;

export interface DiscardAmendmentButtonProps {
  declarationId: string;
  /** The version the amendment started from, which stays in force. */
  fromVersion: number;
  variant?: ButtonProps['variant'];
  /** Adds the bin icon, as next to Continue; the workspace banner's button has none. */
  withIcon?: boolean;
  /** Names what is discarded for screen readers, e.g. "Initial declaration". */
  srContext?: string;
  /** Called once the amendment is gone (a declaration already gone counts). */
  onDiscarded: () => void | Promise<void>;
}

/**
 * "Discard amendment" and its confirmation (spec 06 FE-4, S8): deletes the changes; the
 * submitted version stays in force as it was filed.
 */
export function DiscardAmendmentButton({
  declarationId,
  fromVersion,
  variant = 'destructive-ghost',
  withIcon = false,
  srContext,
  onDiscarded,
}: DiscardAmendmentButtonProps) {
  const copy = DISCARD_AMENDMENT_COPY;
  const { open, setOpen, busy, problem, run } = useConfirmAction<'notAmending' | 'unavailable'>({
    unavailable: 'unavailable',
    action: async () => {
      const result = await discardMyAmendment({ data: { declarationId } });
      if (result.status === 'discarded' || result.status === 'not-found') {
        await onDiscarded();
        return { status: 'done' };
      }
      if (result.status === 'unauthenticated') return result;
      return {
        status: 'problem',
        problem: result.status === 'not-amending' ? 'notAmending' : 'unavailable',
      };
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="sm"
          aria-label={srContext ? `${copy.trigger}: ${srContext}` : undefined}
        >
          {withIcon ? <Icon icon={Delete02Icon} /> : null}
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent busy={busy}>
        <DialogHeader className="flex-row items-center gap-3">
          <IconTile>
            <Icon icon={Undo02Icon} />
          </IconTile>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription className="text-[15px] text-foreground">
            {copy.body(fromVersion)}
          </DialogDescription>
          {problem ? (
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>{copy[problem]}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setOpen(false);
            }}
          >
            {copy.keep}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void run()}>
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
