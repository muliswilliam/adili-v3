import {
  AiLabel,
  AssistantMessage,
  Button,
  ChatComposer,
  ChatLog,
  ChatPanel,
  cn,
  focusRing,
  type Feedback,
  FeedbackControl,
  Icon,
  Skeleton,
  SuggestedQuestions,
  Tooltip,
  UserMessage,
} from '@adili/ui';
import { ArrowRight02Icon, File01Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { ASK_COPY, type AskCopy, type AskLanguage } from '../../assistant/copy';
import { ASSISTANT_NOTE_MAX_LENGTH } from '../../assistant/limits';
import { linkedItem, linkPlace } from '../../assistant/place';
import { type AskTopic, suggestedQuestions } from '../../assistant/suggested';
import { sectionKind } from '../../declaration/section-key';
import type { Category } from '../../declaration/statement';
import { TYPE_LABELS } from '../../declaration/labels';
import { rateAssistantAnswer } from '../../server/assistant';
import { getDeclarationSection } from '../../server/declarations';
import type { SectionContents } from '../../server/declarations.server';
import type {
  AssistantMessage as Message,
  DeclarationSection,
} from '../../server/declarations/types';
import { sectionLink, stepLink } from '../declaration/steps';

export { AskAdiliBarButton, AskAdiliLauncher, useAskAdiliTab } from './context';
import { AskAdiliContext } from './context';
import { HelpSearch } from './help-search';
import { type PendingTurn, turnKey, useConversation } from './use-conversation';

/**
 * Ask Adili (spec 11 FE-2, #335): the panel a declarant asks the Act, the Regulations and help
 * articles from, on the dashboard and every workspace screen. `AskAdiliProvider` holds the panel
 * and its conversation for the page (so it stays open from section to section); the launcher and
 * the workspace's phone bar open it; a statement screen says which tab it shows
 * (`useAskAdiliTab`), for the suggestions and the "On:" line.
 *
 * On wide screens (1200px and up) the panel docks beside the page, which makes room for it; from
 * 700px it lies over the page's right edge; on phones it rises as a sheet over a scrim. Esc and
 * the close button close it, and focus goes back to what opened it.
 */

const DOCKED = '(min-width: 1200px)';
/** The panel's width beside the page, and the room the page makes for it when docked. */
const PANEL_WIDTH = 'w-[392px]';
const PANEL_ROOM = 'pr-[392px]';
const SIDE = '(min-width: 700px)';

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => {
        media.removeEventListener('change', onChange);
      };
    },
    () => typeof window.matchMedia !== 'function' || window.matchMedia(query).matches,
    () => true,
  );
}

function topicOf(step: string, tab: Category | null): AskTopic {
  if (step === 'home' || step === 'overview' || step === 'summary') return step;
  const kind = sectionKind(step);
  if (kind === 'statement') return tab ?? 'income';
  return kind ?? 'overview';
}

export interface AskAdiliProviderProps {
  /** The draft the page works on; null on the dashboard (the conversation outside a draft). */
  declarationId: string | null;
  /** The draft's sections, to name and check where answers link to. */
  sections?: readonly DeclarationSection[];
  /** `home` on the dashboard; on the workspace, the step shown (`overview`, a section key, `summary`). */
  step: string;
  children: ReactNode;
}

export function AskAdiliProvider({
  declarationId,
  sections = [],
  step,
  children,
}: AskAdiliProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [language, setLanguage] = useState<AskLanguage>('en');
  const [tab, setTab] = useState<Category | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const docked = useMedia(DOCKED);
  const side = useMedia(SIDE);
  const copy = ASK_COPY[language];

  const open = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpened(true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Focus goes back to whatever opened the panel once it has closed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !isOpen) {
      const back = opener.current;
      (back?.isConnected && back !== document.body ? back : launcherRef.current)?.focus();
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  const value = useMemo(
    () => ({ isOpen, open, close, copy, setTab, launcherRef }),
    [isOpen, open, close, copy],
  );

  return (
    <AskAdiliContext.Provider value={value}>
      {/* On phones the open sheet is modal: the page behind it is inert. */}
      <div
        inert={isOpen && !side}
        className={cn('flex flex-1 flex-col', isOpen && docked && PANEL_ROOM)}
      >
        {children}
      </div>
      {opened ? (
        <Panel
          hidden={!isOpen}
          declarationId={declarationId}
          sections={sections}
          topic={topicOf(step, tab)}
          sectionKey={declarationId && sectionKind(step) ? step : null}
          language={language}
          onLanguage={setLanguage}
          onClose={close}
        />
      ) : null}
    </AskAdiliContext.Provider>
  );
}

function Panel({
  hidden,
  declarationId,
  sections,
  topic,
  sectionKey,
  language,
  onLanguage,
  onClose,
}: {
  hidden: boolean;
  declarationId: string | null;
  sections: readonly DeclarationSection[];
  topic: AskTopic;
  sectionKey: string | null;
  language: AskLanguage;
  onLanguage: (language: AskLanguage) => void;
  onClose: () => void;
}) {
  const copy = ASK_COPY[language];
  const side = useMedia(SIDE);
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const {
    conversation,
    pending,
    keyOf,
    unavailable,
    ask,
    stop,
    setRating,
    resume,
    clearPending,
    reload,
  } = useConversation({ declarationId, language, active: true });

  // Each answer that links to an item reads the section as it is now (no cache: it changes as
  // the declarant edits it).
  const readSection = useCallback(
    (sectionKey: string): Promise<SectionContents | null> =>
      declarationId
        ? getDeclarationSection({ data: { declarationId, sectionKey } })
            .then((result) => (result.status === 'ok' ? result.section.contents : null))
            .catch(() => null)
        : Promise.resolve(null),
    [declarationId],
  );

  const busy = pending?.status === 'thinking' || pending?.status === 'streaming';
  const ready = conversation.status === 'ready';
  // Help search when answers are unavailable, or when the conversation could not be opened.
  const helpMode = unavailable ?? (conversation.status === 'failed' ? { question: '' } : null);
  const inHelpSearch = helpMode !== null;

  // Closing ends an answer on its way; what came stays, with Try again.
  useEffect(() => {
    if (hidden) stop();
  }, [hidden, stop]);

  // Opening puts the cursor in the question box (or the help search, which focuses itself).
  useEffect(() => {
    if (hidden || !ready || inHelpSearch) return;
    // ...with the latest turn in view.
    const log = panelRef.current?.querySelector('[role="log"]');
    if (log) log.scrollTop = log.scrollHeight;
    panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }, [hidden, ready, inHelpSearch]);

  if (hidden) return null;

  const messages = conversation.status === 'ready' ? conversation.messages : [];
  // The latest answer's: a decline made without the AI has none, and nor then does the header.
  const latestLabel = messages.findLast((message) => message.role === 'assistant')?.label;
  const onSection = copy.sectionNames[topic];

  function send(question: string) {
    void ask(question, { sectionKey });
  }

  function retry() {
    if (!pending) return;
    const { question } = pending;
    clearPending();
    void ask(question, { sectionKey });
  }

  function openPlace(step: string, field: string | null) {
    if (!declarationId) return;
    if (!side) onClose();
    void navigate(
      field ? sectionLink(declarationId, step, { field }) : stepLink(declarationId, step),
    );
  }

  /** "Read in help": the passage's help page, in the panel's language. */
  function readPassage(passageId: string) {
    void navigate({ to: '/help/$passageId', params: { passageId }, search: { lang: language } });
  }

  function switchLanguage(next: AskLanguage) {
    if (next === language) return;
    onLanguage(next);
    setAnnouncement(ASK_COPY[next].languageChanged);
  }

  const languageSwitch = (
    <div
      role="group"
      aria-label={copy.language}
      className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {(['en', 'sw'] as const).map((code) => (
        <Button
          key={code}
          type="button"
          size="xs"
          variant={language === code ? 'secondary' : 'ghost'}
          aria-pressed={language === code}
          // An answer on its way belongs to this language's conversation.
          disabled={busy}
          lang={code}
          onClick={() => {
            switchLanguage(code);
          }}
          className={cn(
            'h-[26px] px-2 text-[12.5px]',
            language === code ? 'bg-card shadow-control' : 'text-secondary-foreground',
          )}
        >
          {code === 'en' ? 'English' : 'Kiswahili'}
        </Button>
      ))}
    </div>
  );

  return (
    <>
      {side ? null : (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-scrim" onClick={onClose} />
      )}
      <ChatPanel
        ref={panelRef}
        lang={language}
        title={copy.title}
        variant={side ? 'side' : 'sheet'}
        onClose={onClose}
        messages={{ close: copy.close }}
        // On phones the sheet covers the page, so it is modal: Tab stays inside it.
        {...(side ? {} : { 'aria-modal': true, role: 'dialog' })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          } else if (event.key === 'Tab' && !side) {
            keepFocusInside(event.currentTarget, event);
          }
        }}
        className={cn(
          'fixed right-0 bottom-0 z-45',
          side
            ? `top-[61px] h-auto ${PANEL_WIDTH} border-l shadow-pop min-[1200px]:shadow-none`
            : 'left-0 h-[88dvh] max-h-[calc(100dvh-24px)]',
        )}
        headerActions={
          <Tooltip content={declarationId ? copy.kept : copy.keptOutside}>
            <button
              type="button"
              className={cn(
                focusRing,
                'grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4',
              )}
            >
              <Icon icon={InformationCircleIcon} />
              <span className="sr-only">{declarationId ? copy.kept : copy.keptOutside}</span>
            </button>
          </Tooltip>
        }
        meta={
          <>
            <AiLabel
              text={copy.label}
              {...(latestLabel ? { details: latestLabel } : {})}
              messages={{ noDetails: copy.labelDetails }}
            />
            {languageSwitch}
          </>
        }
        footer={
          helpMode || !ready ? undefined : (
            <>
              <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground [&_svg]:size-[13px]">
                <Icon icon={File01Icon} /> {copy.on}: {onSection}
              </p>
              <ChatComposer
                onSend={send}
                busy={busy}
                value={draft}
                onValueChange={setDraft}
                messages={{
                  placeholder: declarationId ? copy.placeholder : copy.placeholderOutside,
                  send: copy.send,
                }}
              />
              <p className="text-xs leading-[1.45] text-muted-foreground">{copy.privacy}</p>
            </>
          )
        }
      >
        {helpMode ? (
          <HelpSearch
            key={helpMode.question}
            copy={copy}
            language={language}
            sectionKey={sectionKey}
            initialQuery={helpMode.question}
            sectionQuery={onSection}
            onAskAgain={conversation.status === 'failed' ? reload : resume}
            declarationId={declarationId}
            onFix={openPlace}
          />
        ) : !ready ? (
          <div className="grid gap-3 p-4" aria-busy="true">
            <span className="sr-only">{copy.loading}</span>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-9 w-1/2" />
          </div>
        ) : (
          <ChatLog label={copy.conversation}>
            {messages.length === 0 && !pending ? (
              <>
                <p className="text-sm text-secondary-foreground">{copy.idle}</p>
                <SuggestedQuestions
                  label={copy.suggested}
                  questions={suggestedQuestions(topic, language)}
                  onAsk={send}
                />
              </>
            ) : null}
            {/* One list, so a turn's bubbles keep their keys from pending to stored. */}
            {[
              ...messages.map((message) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={keyOf(message)}
                    text={message.text}
                    messages={{ userName: copy.message.userName }}
                  />
                ) : (
                  <Answer
                    key={keyOf(message)}
                    answer={{ kind: 'stored', message }}
                    conversationId={conversation.id}
                    declarationId={declarationId}
                    copy={copy}
                    sections={sections}
                    language={language}
                    readSection={readSection}
                    onOpenPlace={openPlace}
                    onReadPassage={readPassage}
                    onRated={setRating}
                  />
                ),
              ),
              ...(pending
                ? [
                    <UserMessage
                      key={turnKey(pending.turn, 'question')}
                      text={pending.question}
                      messages={{ userName: copy.message.userName }}
                    />,
                    <Answer
                      key={turnKey(pending.turn, 'answer')}
                      answer={{ kind: 'pending', turn: pending, onRetry: retry }}
                      conversationId={conversation.id}
                      declarationId={declarationId}
                      copy={copy}
                      sections={sections}
                      language={language}
                      readSection={readSection}
                      onOpenPlace={openPlace}
                      onReadPassage={readPassage}
                      onRated={setRating}
                    />,
                  ]
                : []),
            ]}
          </ChatLog>
        )}
        <div role="status" className="sr-only">
          {announcement}
        </div>
      </ChatPanel>
    </>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Wraps Tab from the last control to the first, and Shift+Tab the other way. */
function keepFocusInside(container: HTMLElement, event: KeyboardEvent) {
  const controls = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.closest('[hidden]'),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** A draft section's contents, read once per panel; null when it cannot be read. */
type ReadSection = (sectionKey: string) => Promise<SectionContents | null>;

type AnswerSource =
  | { kind: 'stored'; message: Message }
  | { kind: 'pending'; turn: PendingTurn; onRetry: () => void };

/** "Try again in a minute", or in the seconds the service asked for when it said. */
function rateLimitedCopy(copy: AskCopy, seconds: number | undefined): string {
  return seconds && seconds !== 60 ? copy.rateLimitedFor(seconds) : copy.message.rateLimited;
}

/**
 * One answer, from its first dots to the stored message: the same element throughout, so its
 * live region reads the sentences as they finish and then the end, or the decline.
 */
function Answer({
  answer,
  conversationId,
  declarationId,
  copy,
  sections,
  language,
  readSection,
  onOpenPlace,
  onReadPassage,
  onRated,
}: {
  answer: AnswerSource;
  conversationId: string;
  declarationId: string | null;
  copy: AskCopy;
  sections: readonly DeclarationSection[];
  language: AskLanguage;
  readSection: ReadSection;
  onOpenPlace: (step: string, field: string | null) => void;
  onReadPassage: (passageId: string) => void;
  onRated: (messageId: string, rating: Message['rating']) => void;
}) {
  const message = answer.kind === 'stored' ? answer.message : null;
  const [feedback, setFeedback] = useState<Feedback | null>(
    message?.rating ? { rating: message.rating, reason: null, note: null } : null,
  );
  const link = declarationId && message?.sectionLink ? message.sectionLink : null;
  const itemName = useLinkedItemName(link, readSection);
  const place = link ? linkPlace(link, sections, language, itemName) : null;

  if (answer.kind === 'pending') {
    const { turn } = answer;
    return (
      <AssistantMessage
        status={turn.status}
        text={turn.text}
        onRetry={turn.status === 'error' ? answer.onRetry : undefined}
        messages={{
          ...copy.message,
          rateLimited: rateLimitedCopy(copy, turn.retryAfterSeconds),
        }}
      />
    );
  }

  const stored = answer.message;
  const officer = stored.reportingOfficer;

  async function rate(next: Feedback) {
    const result = await rateAssistantAnswer({
      data: { conversationId, messageId: stored.id, ...next },
    });
    if (result.status === 'unauthenticated') window.location.reload();
    if (result.status !== 'rated') throw new Error(result.status);
    setFeedback(next);
    onRated(stored.id, next.rating);
  }

  return (
    <AssistantMessage
      status={stored.declined ? 'declined' : 'answered'}
      text={stored.text}
      citations={stored.citations}
      onReadPassage={(citation) => {
        onReadPassage(citation.id);
      }}
      officer={
        officer
          ? {
              name: officer.name,
              email: officer.email,
              ...(officer.phone ? { phone: officer.phone } : {}),
            }
          : undefined
      }
      // Without a contact on record the decline ends with the sentence, not a colon.
      messages={officer ? copy.message : { ...copy.message, declined: copy.declinedNoContact }}
      actions={
        <>
          {place ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                onOpenPlace(place.step, place.field);
              }}
            >
              <Icon icon={ArrowRight02Icon} />
              {place.label}
            </Button>
          ) : null}
          <FeedbackControl
            value={feedback}
            onRate={rate}
            noteMaxLength={ASSISTANT_NOTE_MAX_LENGTH}
            messages={copy.feedback}
            className="w-full items-stretch [&>[role=group]]:self-start"
          />
        </>
      }
    />
  );
}

/**
 * The type of the statement item an answer links to ("Vehicle"), read from the draft's section
 * so the button names it; undefined while it loads, or when the link is not to an item.
 */
function useLinkedItemName(
  link: Message['sectionLink'],
  readSection: ReadSection,
): string | undefined {
  const item = link ? linkedItem(link) : null;
  const sectionKey = link?.sectionKey;
  const key = item && sectionKey ? `${sectionKey}|${item.category}|${String(item.index)}` : null;
  const [named, setNamed] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    if (!key || !item || !sectionKey) return;
    let current = true;
    void readSection(sectionKey).then((contents) => {
      const items = contents?.[item.category];
      const type = Array.isArray(items)
        ? (items[item.index] as { type?: unknown } | undefined)?.type
        : undefined;
      const name = typeof type === 'string' ? TYPE_LABELS[item.category][type] : undefined;
      if (current && name) setNamed({ key, name });
    });
    return () => {
      current = false;
    };
    // `item` and `sectionKey` are what `key` is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, readSection]);

  return named?.key === key ? named.name : undefined;
}
