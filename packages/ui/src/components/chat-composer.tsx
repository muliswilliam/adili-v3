import { SentIcon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type SyntheticEvent, useState } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { Icon } from './icon';

/** Longest question the assistant contract accepts. */
export const CHAT_QUESTION_MAX_LENGTH = 2000;

export interface ChatComposerMessages {
  /** The box's placeholder and accessible name. */
  placeholder: string;
  send: string;
}

const DEFAULT_MESSAGES: ChatComposerMessages = {
  placeholder: 'Ask about this section…',
  send: 'Send',
};

export type ChatComposerProps = Omit<ComponentProps<'form'>, 'children' | 'onSubmit'> & {
  /** Called with the trimmed question; the box then empties. */
  onSend: (question: string) => void;
  /** The draft, to keep it outside the composer (e.g. while the panel is closed). */
  value?: string;
  onValueChange?: (value: string) => void;
  /** An answer is on its way: typing goes on, sending waits. */
  busy?: boolean;
  disabled?: boolean;
  maxLength?: number;
  messages?: Partial<ChatComposerMessages>;
};

/**
 * The box a question is typed in, growing with it up to 120px, and a send button. Enter sends and
 * Shift+Enter adds a line (not while an input method is composing). A blank question is not sent,
 * and while `busy` the question is kept until the answer ends.
 */
export function ChatComposer({
  onSend,
  value,
  onValueChange,
  busy = false,
  disabled = false,
  maxLength = CHAT_QUESTION_MAX_LENGTH,
  messages,
  className,
  ...props
}: ChatComposerProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const [ownDraft, setOwnDraft] = useState('');
  const draft = value ?? ownDraft;

  function setDraft(next: string) {
    if (value === undefined) setOwnDraft(next);
    onValueChange?.(next);
  }

  function send(event: SyntheticEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (busy || disabled || !question) return;
    onSend(question);
    setDraft('');
  }

  return (
    <form
      noValidate
      onSubmit={send}
      className={cn(
        'flex items-end gap-2 rounded-item bg-card py-1.5 pr-1.5 pl-3 shadow-control focus-within:shadow-control-focus',
        disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <textarea
        rows={1}
        value={draft}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={copy.placeholder}
        aria-label={copy.placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          const composing =
            event.nativeEvent.isComposing ||
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari fires the Enter that ends a composition after it, marked only by keyCode 229
            event.keyCode === 229;
          if (event.key !== 'Enter' || event.shiftKey || composing) return;
          send(event);
        }}
        className="field-sizing-content max-h-[120px] min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] leading-[1.45] text-foreground outline-none placeholder:text-placeholder"
      />
      <Button
        type="submit"
        size="icon"
        disabled={disabled}
        aria-disabled={busy || undefined}
        className="rounded-[10px] aria-disabled:cursor-not-allowed aria-disabled:bg-primary-disabled aria-disabled:bg-none aria-disabled:text-primary-disabled-foreground aria-disabled:shadow-none aria-disabled:active:translate-y-0 [&_svg]:size-4"
      >
        <Icon icon={SentIcon} />
        <span className="sr-only">{copy.send}</span>
      </Button>
    </form>
  );
}
