import { Alert02Icon, Clock01Icon, HelpCircleIcon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Button } from './button';
import { type Citation, CitationList, type CitationMessages } from './citation-chip';
import { Icon } from './icon';

// A sentence ends at . ! ? or …, maybe closed by a quote or bracket, then a space. Streaming text
// ending in "s." may go on as "s.31(4)", so a stop is only final once the space arrives.
const SENTENCE_END = /[.!?…]["'”’)\]]*\s+/g;

/**
 * What a streaming answer's live region should say next: the sentences finished since the first
 * `announced` characters, and how far that reaches. Once `finished`, the rest is read too.
 */
export function nextAnnouncement(
  text: string,
  announced: number,
  finished: boolean,
): { text: string; announced: number } {
  const from = announced > text.length ? 0 : announced;
  let to = from;
  if (finished) {
    to = text.length;
  } else {
    for (const match of text.slice(from).matchAll(SENTENCE_END)) {
      to = from + match.index + match[0].length;
    }
  }
  return { text: text.slice(from, to).trim(), announced: to };
}

/** The reporting officer a declined answer points to. */
export interface ReportingOfficer {
  name: string;
  email?: string;
  phone?: string;
}

/**
 * Where an answer is. `thinking` waits for the first words; `error` stopped part-way (a dropped
 * stream, a gateway failure); `rate-limited` was refused for asking too often (429).
 */
export type AssistantMessageStatus =
  'thinking' | 'streaming' | 'answered' | 'declined' | 'error' | 'rate-limited';

export interface ChatMessageMessages extends CitationMessages {
  /** Read before a question for screen readers browsing the log. */
  userName: string;
  /** Read before an answer. */
  assistantName: string;
  answering: string;
  declined: string;
  stopped: string;
  retry: string;
  rateLimited: string;
}

const DEFAULT_MESSAGES: Omit<ChatMessageMessages, keyof CitationMessages> = {
  userName: 'You',
  assistantName: 'Adili',
  answering: 'Adili is answering…',
  declined: 'I could not find this in the Act or Regulations. Ask your reporting officer:',
  stopped: 'The answer stopped before it finished.',
  retry: 'Try again',
  rateLimited: 'You have asked many questions in a short time. Try again in a minute.',
};

const bubbleClassName = 'rounded-[14px] px-[13px] py-2.5 text-sm leading-[1.55]';

export type UserMessageProps = Omit<ComponentProps<'div'>, 'children'> & {
  text: string;
  messages?: Partial<Pick<ChatMessageMessages, 'userName'>>;
};

/** A question, in an ink bubble on the right. */
export function UserMessage({ text, messages, className, ...props }: UserMessageProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  return (
    <div className={cn('flex max-w-[92%] flex-col items-end self-end', className)} {...props}>
      <p
        className={cn(
          bubbleClassName,
          'rounded-br-[5px] bg-primary whitespace-pre-wrap text-primary-foreground',
        )}
      >
        <span className="sr-only">{copy.userName}: </span>
        {text}
      </p>
    </div>
  );
}

export type AssistantMessageProps = Omit<ComponentProps<'div'>, 'children'> & {
  status: AssistantMessageStatus;
  /** The answer so far. Kept on `error` to show how far it got. */
  text?: string;
  /** Shown as chips once answered. */
  citations?: readonly Citation[];
  onReadPassage?: (citation: Citation) => void;
  /** Who a declined answer points to. */
  officer?: ReportingOfficer;
  /** Asks again after `error` or `rate-limited`; the button is left out without it. */
  onRetry?: () => void;
  /** Under an answered or declined message: the section link and the FeedbackControl. */
  actions?: ReactNode;
  messages?: Partial<ChatMessageMessages>;
};

// Shown on mount only when the message is new; answered and declined messages can come from
// history, so they speak only when they change.
const NEW_ONLY: readonly AssistantMessageStatus[] = ['answered', 'declined'];

/**
 * An answer from Adili, in every state: thinking (three dots), streaming (with a caret), answered
 * (with citation chips and `actions`), declined (with the reporting officer's contact), stopped
 * part-way with Try again, and rate-limited. The bubble itself is not live, so screen readers are
 * not read every word: a polite live region reads each finished sentence once, then what the
 * state change means ("Adili is answering…", the decline, the error).
 */
export function AssistantMessage({
  status,
  text = '',
  citations = [],
  onReadPassage,
  officer,
  onRetry,
  actions,
  messages,
  className,
  ...props
}: AssistantMessageProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef<number | null>(null);
  const previousStatus = useRef<AssistantMessageStatus | null>(null);
  const officerName = officer?.name;

  useEffect(() => {
    const first = previousStatus.current === null;
    const changed = previousStatus.current !== status;
    previousStatus.current = status;

    // A message from history starts with its text already read.
    announced.current ??= NEW_ONLY.includes(status) ? text.length : 0;
    if (first && NEW_ONLY.includes(status)) return;

    // Try again streams a new answer, so its sentences are counted from the start.
    if (status === 'thinking') announced.current = 0;

    let next = '';
    if (status === 'streaming' || status === 'answered') {
      const sentences = nextAnnouncement(text, announced.current, status === 'answered');
      announced.current = sentences.announced;
      next = sentences.text;
    } else if (changed) {
      next = {
        thinking: copy.answering,
        declined: officerName ? `${copy.declined} ${officerName}` : copy.declined,
        error: copy.stopped,
        'rate-limited': copy.rateLimited,
      }[status];
    }
    // A live region only speaks when its text changes, so a repeat gets a no-break space.
    if (next) setAnnouncement((previous) => (previous === next ? `${next}\u00a0` : next));
  }, [status, text, officerName, copy.answering, copy.declined, copy.stopped, copy.rateLimited]);

  return (
    <div
      data-status={status}
      className={cn('flex max-w-[92%] flex-col items-start gap-2 self-start', className)}
      {...props}
    >
      <AssistantBody status={status} text={text} officer={officer} onRetry={onRetry} copy={copy} />
      {status === 'answered' ? (
        <CitationList citations={citations} onReadPassage={onReadPassage} messages={messages} />
      ) : null}
      {(status === 'answered' || status === 'declined') && actions ? actions : null}
      <div role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

const assistantBubbleClassName = cn(
  bubbleClassName,
  'rounded-bl-[5px] bg-card whitespace-pre-wrap text-card-foreground shadow-card',
);

const noticeClassName = cn(
  bubbleClassName,
  'flex items-start gap-2.5 rounded-bl-[5px] [&>svg]:mt-[3px] [&>svg]:size-[15px] [&>svg]:shrink-0',
);

const warningClassName = cn(noticeClassName, 'bg-warning-subtle text-warning-subtle-foreground');

const contactLinkClassName = cn(
  focusRing,
  'rounded-sm text-foreground underline decoration-input underline-offset-3 hover:decoration-foreground',
);

function AssistantBody({
  status,
  text,
  officer,
  onRetry,
  copy,
}: {
  status: AssistantMessageStatus;
  text: string;
  officer: ReportingOfficer | undefined;
  onRetry: (() => void) | undefined;
  copy: typeof DEFAULT_MESSAGES;
}) {
  const speaker = <span className="sr-only">{copy.assistantName}: </span>;

  switch (status) {
    case 'thinking':
      return (
        <p
          aria-busy="true"
          className={cn(assistantBubbleClassName, 'inline-flex gap-1 px-3.5 py-[13px]')}
        >
          <span className="sr-only">{copy.answering}</span>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              aria-hidden="true"
              style={{ animationDelay: `${String(delay)}ms` }}
              className="size-1.5 animate-typing rounded-full bg-muted-foreground motion-reduce:animate-none"
            />
          ))}
        </p>
      );
    case 'streaming':
    case 'answered':
      return (
        <p className={assistantBubbleClassName} aria-busy={status === 'streaming' || undefined}>
          {speaker}
          {text}
          {status === 'streaming' ? (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-[15px] w-[7px] animate-caret rounded-[2px] bg-ai align-[-2px] motion-reduce:animate-none"
            />
          ) : null}
        </p>
      );
    case 'declined':
      return (
        <div className={cn(noticeClassName, 'bg-muted text-secondary-foreground')}>
          <Icon icon={HelpCircleIcon} />
          <div>
            <p>
              {speaker}
              {copy.declined}
            </p>
            {officer ? (
              <p className="mt-1.5 grid gap-px text-[13.5px]">
                <b className="font-semibold text-foreground">{officer.name}</b>
                {officer.email ? (
                  <a href={`mailto:${officer.email}`} className={contactLinkClassName}>
                    {officer.email}
                  </a>
                ) : null}
                {officer.phone ? (
                  <a
                    href={`tel:${officer.phone.replace(/\s/g, '')}`}
                    className={contactLinkClassName}
                  >
                    {officer.phone}
                  </a>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      );
    case 'error':
      return (
        <>
          {text ? (
            <p className={assistantBubbleClassName}>
              {speaker}
              {text}…
            </p>
          ) : null}
          <div className={warningClassName}>
            <Icon icon={Alert02Icon} />
            <p>
              {text ? null : speaker}
              {copy.stopped}{' '}
              {onRetry ? (
                <Button
                  variant="link"
                  className="text-sm font-semibold text-inherit"
                  onClick={onRetry}
                >
                  {copy.retry}
                </Button>
              ) : null}
            </p>
          </div>
        </>
      );
    case 'rate-limited':
      return (
        <div className={warningClassName}>
          <Icon icon={Clock01Icon} />
          <p>
            {speaker}
            {copy.rateLimited}
          </p>
        </div>
      );
  }
}
