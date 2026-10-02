import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  IconTile,
  Spinner,
} from '@adili/ui';
import {
  FileRemoveIcon,
  JusticeScale01Icon,
  Package01Icon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';

import { Consequences } from '../resolve-dialogs';
import type { Outcome } from './decision-rules';
import { messages as m } from './messages';

/**
 * "Record partial grant?" (S6): a decision is final and goes to both parties; a grant also
 * sends a Confidential, watermarked package for the download window, or the nil letter when the
 * scope holds nothing (decision 1). The grounds cited are
 * repeated so the officer reads them once more.
 */
export function DecisionConfirmDialog({
  open,
  onOpenChange,
  busy,
  outcome,
  finality,
  packageRecipient,
  packageScope,
  nilLetter = false,
  grounds,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  outcome: Outcome;
  finality: { title: string; text?: string };
  packageRecipient: string;
  /** What the package holds, as `scopeText` writes it. */
  packageScope: string;
  /** The scope holds nothing (its preview is empty): a grant issues the nil letter instead. */
  nilLetter?: boolean;
  /** The grounds' short labels. */
  grounds: string[];
  onConfirm: () => void;
}) {
  const deny = outcome === 'deny';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent busy={busy} aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile tone={deny ? 'destructive' : 'success'}>
            <Icon icon={JusticeScale01Icon} />
          </IconTile>
          <DialogTitle>{m.confirmTitle[outcome]}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <Consequences
            items={[
              { icon: SquareLock02Icon, title: finality.title, text: finality.text },
              ...(deny
                ? []
                : [
                    nilLetter
                      ? {
                          icon: FileRemoveIcon,
                          title: m.nilLetterGoesTo(packageRecipient),
                          text: m.nilLetterScope(packageScope),
                        }
                      : {
                          icon: Package01Icon,
                          title: m.packageGoesTo(packageRecipient),
                          text: m.packageScope(packageScope),
                        },
                  ]),
            ]}
          />
          {outcome !== 'grant' && grounds.length > 0 ? (
            <div className="rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground">
              <b className="font-semibold text-foreground">{m.confirmGrounds}</b>{' '}
              {grounds.join('; ')}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.cancel}
          </Button>
          <Button
            type="button"
            variant={deny ? 'destructive' : 'default'}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy ? <Spinner className="size-4" /> : null}
            {m.recordDecision}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
