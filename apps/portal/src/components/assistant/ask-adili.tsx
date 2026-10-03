import {
  AiLabel,
  Alert,
  AlertDescription,
  AssistantMessage,
  Button,
  ChatComposer,
  ChatLog,
  ChatPanel,
  cn,
  type Feedback,
  FeedbackControl,
  Icon,
  Skeleton,
  SuggestedQuestions,
  Tooltip,
  UserMessage,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight02Icon,
  File01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { ASK_COPY, type AskCopy, type AskLanguage } from '../../assistant/copy';
import { linkPlace } from '../../assistant/place';
import { type AskTopic, suggestedQuestions } from '../../assistant/suggested';
import { sectionKind } from '../../declaration/section-key';
import type { Category } from '../../declaration/statement';
import { rateAssistantAnswer } from '../../server/assistant';
import type {
  AssistantMessage as Message,
  DeclarationSection,
} from '../../server/declarations/types';
import { stepLink } from '../declaration/steps';

export { AskAdiliBarButton, AskAdiliLauncher, useAskAdiliTab } from './context';
import { AskAdiliContext } from './context';
import { HelpSearch } from './help-search';
import { useConversation } from './use-conversation';

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
      <div className={cn('flex flex-1 flex-col', isOpen && docked && 'pr-[392px]')}>{children}</div>
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
  const { conversation, pending, unavailable, ask, stop, setRating, resume, clearPending, reload } =
    useConversation({ declarationId, language, active: true });

  const busy = pending?.status === 'thinking' || pending?.status === 'streaming';
  const ready = conversation.status === 'ready';

  // Closing ends an answer on its way; what came stays, with Try again.
  useEffect(() => {
    if (hidden) stop();
  }, [hidden, stop]);

  // Opening puts the cursor in the question box (or the help search, which focuses itself).
  useEffect(() => {
    if (hidden || !ready || unavailable) return;
    // ...with the latest turn in view.
    const log = panelRef.current?.querySelector('[role="log"]');
    if (log) log.scrollTop = log.scrollHeight;
    panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }, [hidden, ready, unavailable]);

  if (hidden) return null;

  const messages = conversation.status === 'ready' ? conversation.messages : [];
  const latestLabel = [...messages].reverse().find((message) => message.label)?.label;
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
    void navigate({
      ...stepLink(declarationId, step),
      ...(field ? { search: { field } as never } : {}),
    });
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
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        className={cn(
          'fixed right-0 bottom-0 z-45',
          side
            ? 'top-[61px] h-auto w-[392px] shadow-[-1px_0_0_var(--color-border),-12px_0_32px_-18px_rgba(20,20,20,0.25)] min-[1200px]:shadow-[-1px_0_0_var(--color-border)]'
            : 'left-0 h-[88dvh] max-h-[calc(100dvh-24px)]',
        )}
        headerActions={
          <Tooltip content={declarationId ? copy.kept : copy.keptOutside}>
            <button
              type="button"
              className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4"
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
          unavailable || !ready ? undefined : (
            <>
              <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground [&_svg]:size-[13px]">
                <Icon icon={File01Icon} /> {copy.on}: {onSection}
              </p>
              <ChatComposer
                onSend={send}
                busy={busy}
                value={draft}
                onValueChange={setDraft}
                messages={{ placeholder: copy.placeholder, send: copy.send }}
              />
              <p className="text-xs leading-[1.45] text-muted-foreground">{copy.privacy}</p>
            </>
          )
        }
      >
        {conversation.status === 'failed' ? (
          <div className="p-4">
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription className="grid justify-items-start gap-2">
                {copy.loadFailed}
                <Button type="button" variant="secondary" size="sm" onClick={reload}>
                  {copy.retryLoad}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : unavailable ? (
          <HelpSearch
            key={unavailable.question}
            copy={copy}
            language={language}
            sectionKey={sectionKey}
            initialQuery={unavailable.question}
            sectionQuery={onSection}
            onAskAgain={resume}
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
            {messages.map((message) =>
              message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  text={message.text}
                  messages={{ userName: copy.message.userName }}
                />
              ) : (
                <Answer
                  key={message.id}
                  message={message}
                  conversationId={conversation.id}
                  copy={copy}
                  place={
                    declarationId && message.sectionLink
                      ? linkPlace(message.sectionLink, sections, language)
                      : null
                  }
                  onOpenPlace={openPlace}
                  onRated={setRating}
                />
              ),
            )}
            {pending ? (
              <>
                <UserMessage
                  text={pending.question}
                  messages={{ userName: copy.message.userName }}
                />
                <AssistantMessage
                  status={pending.status}
                  text={pending.text}
                  onRetry={pending.status === 'error' ? retry : undefined}
                  messages={copy.message}
                />
              </>
            ) : null}
          </ChatLog>
        )}
        <div role="status" className="sr-only">
          {announcement}
        </div>
      </ChatPanel>
    </>
  );
}

function Answer({
  message,
  conversationId,
  copy,
  place,
  onOpenPlace,
  onRated,
}: {
  message: Message;
  conversationId: string;
  copy: AskCopy;
  place: ReturnType<typeof linkPlace>;
  onOpenPlace: (step: string, field: string | null) => void;
  onRated: (messageId: string, rating: Message['rating']) => void;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(
    message.rating ? { rating: message.rating, reason: null, note: null } : null,
  );
  const officer = message.reportingOfficer;

  async function rate(next: Feedback) {
    const result = await rateAssistantAnswer({
      data: { conversationId, messageId: message.id, ...next },
    });
    if (result.status !== 'rated') throw new Error(result.status);
    setFeedback(next);
    onRated(message.id, next.rating);
  }

  return (
    <AssistantMessage
      status={message.declined ? 'declined' : 'answered'}
      text={message.text}
      citations={message.citations}
      officer={
        officer
          ? {
              name: officer.name,
              email: officer.email,
              ...(officer.phone ? { phone: officer.phone } : {}),
            }
          : undefined
      }
      messages={copy.message}
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
            noteMaxLength={500}
            messages={copy.feedback}
            className="items-start"
          />
        </>
      }
    />
  );
}
