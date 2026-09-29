import { Cancel01Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';

import { cn } from '../lib/cn';
import { focusRingInset } from '../lib/focus';
import { Button } from './button';
import { Icon } from './icon';

export interface ChatPanelMessages {
  close: string;
}

export type ChatPanelProps = Omit<ComponentProps<'aside'>, 'title'> & {
  /** The panel's heading, which names the landmark: "Ask Adili". */
  title: string;
  /** Shows a close button in the header. */
  onClose?: () => void;
  /** Beside the close button, e.g. a tooltip saying where the conversation is kept. */
  headerActions?: ReactNode;
  /** The row under the title: the AiLabel and the language switch. */
  meta?: ReactNode;
  /** Under the log: the context line, the ChatComposer and the privacy note. */
  footer?: ReactNode;
  /** `side` fills a docked column; `sheet` adds a grab handle and rounded top for phones. */
  variant?: 'side' | 'sheet';
  messages?: Partial<ChatPanelMessages>;
};

/**
 * The frame of a chat side panel: a `complementary` landmark named by its heading, with a header
 * (sparkle tile, title, close), the log as its children and a footer. It fills its container; the
 * page docks it beside the content, or sits it at the bottom as a sheet on phones.
 */
export function ChatPanel({
  title,
  onClose,
  headerActions,
  meta,
  footer,
  variant = 'side',
  messages,
  className,
  children,
  ...props
}: ChatPanelProps) {
  const copy = { close: 'Close', ...messages };
  const titleId = useId();

  return (
    <aside
      aria-labelledby={titleId}
      className={cn(
        'flex h-full min-h-0 flex-col bg-card text-card-foreground',
        variant === 'sheet' && 'rounded-t-[22px] shadow-pop',
        className,
      )}
      {...props}
    >
      <header className={cn('border-b px-4 pb-3', variant === 'sheet' ? 'pt-2.5' : 'pt-3.5')}>
        {variant === 'sheet' ? (
          <div
            data-grab
            aria-hidden="true"
            className="mx-auto mb-2 h-1 w-[38px] rounded bg-input"
          />
        ) : null}
        <div className="flex items-center gap-2.5">
          <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-ai-subtle text-ai [&_svg]:size-4">
            <Icon icon={SparklesIcon} />
          </span>
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold">
            {title}
          </h2>
          {headerActions}
          {onClose ? (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <Icon icon={Cancel01Icon} />
              <span className="sr-only">{copy.close}</span>
            </Button>
          ) : null}
        </div>
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">{meta}</div>
        ) : null}
      </header>
      {children}
      {footer ? <div className="grid gap-2 border-t px-4 pt-2.5 pb-3.5">{footer}</div> : null}
    </aside>
  );
}

/** How close to the bottom, in pixels, still counts as reading the latest message. */
const FOLLOW_THRESHOLD = 90;

export type ChatLogProps = ComponentProps<'div'> & {
  /** Names the log. Defaults to "Conversation". */
  label?: string;
};

/**
 * The scrolling list of messages, as a `log`. It is not live (`aria-live="off"`): each
 * AssistantMessage reads its own finished sentences, so streamed words are not read one by one.
 * It follows new text while the reader is at the bottom, and stays put once they scroll up. It
 * takes keyboard focus so it can be scrolled without a mouse. Also holds the idle intro and
 * suggested questions.
 */
export function ChatLog({ label = 'Conversation', className, onScroll, ...props }: ChatLogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const log = ref.current;
    if (!log) return;
    const observer = new MutationObserver(() => {
      if (following.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(log, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      role="log"
      aria-live="off"
      aria-label={label}
      tabIndex={0}
      onScroll={(event) => {
        const log = event.currentTarget;
        following.current = log.scrollHeight - log.scrollTop - log.clientHeight < FOLLOW_THRESHOLD;
        onScroll?.(event);
      }}
      className={cn(
        focusRingInset,
        'flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4',
        className,
      )}
      {...props}
    />
  );
}
