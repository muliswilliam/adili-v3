import {
  Button,
  CardIcon,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
} from '@adili/ui';
import { Delete02Icon } from '@hugeicons/core-free-icons';

import { messages as m } from './messages';

/**
 * "Discard this upload?", asked when the user leaves the wizard with an upload in flight or a
 * clean file not imported yet. Closing it any other way keeps working.
 */
export function DiscardUploadDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
      }}
    >
      <DialogContent>
        <DialogHeader className="flex-row items-center gap-3">
          <CardIcon className="mb-0 bg-destructive-subtle text-destructive">
            <Icon icon={Delete02Icon} />
          </CardIcon>
          <DialogTitle>{m.discardTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription className="text-[15px] leading-relaxed text-secondary-foreground">
            {m.discardText}
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{m.keepWorking}</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onDiscard}>
            {m.discardUpload}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
