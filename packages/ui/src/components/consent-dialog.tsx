import { BankIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useRef, useState } from 'react';

import { listNames } from '../lib/list-names';
import { Button } from './button';
import { CheckboxItem } from './checkbox';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Icon } from './icon';
import { SOURCE_KINDS, SOURCE_NAMES } from './source-badge';

/** A national ID with all but its last three digits hidden: "12345678" → "•••••678". */
export function maskNationalId(id: string): string {
  const trimmed = id.trim();
  return '•'.repeat(Math.max(0, trimmed.length - 3)) + trimmed.slice(-3);
}

/** Every registry a check can ask, by name: every source but a document. */
const EVERY_REGISTRY = SOURCE_KINDS.filter((kind) => kind !== 'document').map(
  (kind) => SOURCE_NAMES[kind],
);

export interface ConsentMessages {
  title: string;
  /**
   * The consent text. `maskedId` is absent when the person's ID is not known; `registries` names
   * the registries asked, in a sentence (see `listNames`).
   */
  body: (name: string, maskedId: string | undefined, registries: string) => ReactNode;
  confirm: string;
  cancel: string;
  continue: string;
}

const DEFAULT_MESSAGES: ConsentMessages = {
  title: 'Check registries',
  body: (name, maskedId, registries) =>
    `Adili will ask ${registries} what they hold about ${name}${
      maskedId ? ` (${maskedId})` : ''
    } and show the results to you only. Nothing is added unless you accept it.`,
  confirm: 'I request this check',
  cancel: 'Cancel',
  continue: 'Continue',
};

export interface ConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose records are checked, e.g. "Mary Wanjiru Kennedy". */
  name: string;
  /** Their national ID, already masked (see `maskNationalId`). Left out of the text when absent. */
  maskedId?: string;
  /**
   * The registries this check asks, by name, e.g. `['ArdhiSasa']` to retry one. Defaults to
   * every registry.
   */
  registries?: readonly string[];
  /**
   * Called when the declarant has ticked the request and pressed Continue. Close the dialog here.
   */
  onContinue: () => void;
  /** Set while the consent is being recorded: nothing can be changed or closed. */
  busy?: boolean;
  /** Replaces any of the default copy. */
  messages?: Partial<ConsentMessages>;
}

/**
 * Asks the declarant to request a registry check for one person before anything is looked up. A
 * modal: focus is trapped while it is open and returns to the button that opened it. Continue
 * stays disabled until "I request this check" is ticked, and the tick is cleared every time the
 * dialog opens. The open state is controlled by the caller.
 */
export function ConsentDialog({
  open,
  onOpenChange,
  name,
  maskedId,
  registries = EVERY_REGISTRY,
  onContinue,
  busy = false,
  messages: overrides,
}: ConsentDialogProps) {
  const messages = { ...DEFAULT_MESSAGES, ...overrides };
  // Opened from a plain button rather than a DialogTrigger, so Radix has nowhere to return focus.
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        busy={busy}
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <DialogHeader className="flex-row items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-muted text-secondary-foreground"
          >
            <Icon icon={BankIcon} className="size-[17px]" />
          </span>
          <DialogTitle>{messages.title}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open, so the tick starts cleared each time. */}
        <ConsentForm
          body={messages.body(name, maskedId, listNames(registries))}
          messages={messages}
          busy={busy}
          onContinue={onContinue}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConsentForm({
  body,
  messages,
  busy,
  onContinue,
}: {
  body: ReactNode;
  messages: ConsentMessages;
  busy: boolean;
  onContinue: () => void;
}) {
  const [requested, setRequested] = useState(false);

  return (
    <>
      <DialogBody>
        <DialogDescription className="text-[15px] leading-relaxed text-foreground">
          {body}
        </DialogDescription>
        <CheckboxItem
          label={messages.confirm}
          checked={requested}
          disabled={busy}
          onChange={(event) => {
            setRequested(event.target.checked);
          }}
        />
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {messages.cancel}
          </Button>
        </DialogClose>
        <Button type="button" disabled={!requested || busy} onClick={onContinue}>
          {messages.continue}
        </Button>
      </DialogFooter>
    </>
  );
}
