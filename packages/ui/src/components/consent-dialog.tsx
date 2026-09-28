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
import { SOURCE_KINDS, SOURCE_NAMES, type SourceKind } from './source-badge';

/** A national ID with all but its last three digits hidden: "12345678" → "•••••678". */
export function maskNationalId(id: string): string {
  const trimmed = id.trim();
  return '•'.repeat(Math.max(0, trimmed.length - 3)) + trimmed.slice(-3);
}

/** A registry a check can ask: any source but a document. */
export type RegistryKind = Exclude<SourceKind, 'document'>;

/** Every registry a check can ask, in the order the consent text names them. */
export const REGISTRY_KINDS: readonly RegistryKind[] = SOURCE_KINDS.filter(
  (kind): kind is RegistryKind => kind !== 'document',
);

/** The version of the default consent text (`ConsentMessages.body`): bump it on any change. */
const CONSENT_TEMPLATE_VERSION = 'registry-consent.v1';

/** The registries asked, once each, in the fixed order of `REGISTRY_KINDS`. */
function inOrder(registries: readonly RegistryKind[]): RegistryKind[] {
  return REGISTRY_KINDS.filter((kind) => registries.includes(kind));
}

/**
 * Identifies the exact consent text shown for a check of `registries`: the template version and
 * the registries the text names, in the fixed order, e.g.
 * `registry-consent.v1:kra+ntsa+brs+ardhisasa`. Build it from the same list passed to
 * `ConsentDialog` and send it with the lookup.
 */
export function consentTextVersion(registries: readonly RegistryKind[]): string {
  return `${CONSENT_TEMPLATE_VERSION}:${inOrder(registries).join('+')}`;
}

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
   * The registries this check asks, e.g. `['ardhisasa']` to retry one; the text names them in
   * the fixed order. Defaults to every registry. Send `consentTextVersion` of the same list with
   * the lookup.
   */
  registries?: readonly RegistryKind[];
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
  registries = REGISTRY_KINDS,
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
          body={messages.body(
            name,
            maskedId,
            listNames(inOrder(registries).map((kind) => SOURCE_NAMES[kind])),
          )}
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
