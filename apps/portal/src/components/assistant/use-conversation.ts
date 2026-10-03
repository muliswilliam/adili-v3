import { type AssistantMessageStatus } from '@adili/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AskLanguage } from '../../assistant/copy';
import { readAnswerStream } from '../../assistant/stream';
import { openAssistantConversation } from '../../server/assistant';
import type { AssistantMessage } from '../../server/declarations/types';

/** The question being answered, and how far its answer got. */
export interface PendingTurn {
  /** Which question this is, so its bubbles stay the same when the stored turns replace them. */
  turn: number;
  question: string;
  status: Extract<AssistantMessageStatus, 'thinking' | 'streaming' | 'error' | 'rate-limited'>;
  text: string;
  /** For `rate-limited`: when to ask again. */
  retryAfterSeconds?: number;
}

/** The key a turn's bubbles render under, pending and stored alike: `turn-<n>-question`. */
export const turnKey = (turn: number, role: 'question' | 'answer') =>
  `turn-${String(turn)}-${role}`;

export type ConversationState =
  | { status: 'closed' }
  | { status: 'loading' }
  /** It could not be opened (the service is down, or no Commission to ask about): help search. */
  | { status: 'failed' }
  | {
      status: 'ready';
      id: string;
      messages: AssistantMessage[];
      /** Answers can be rated here (ASSISTANT_FEEDBACK). */
      feedback: boolean;
    };

export interface AskContext {
  sectionKey: string | null;
}

/** The browser's route that relays an answer's server-sent events (see `relayAnswer`). */
export const answerUrl = (conversationId: string) =>
  `/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages`;

/**
 * The declarant's Ask Adili conversation: opened (or resumed) when the panel first opens and
 * again in the other language, a question streamed into a pending turn that the stored turns
 * replace at the end. A refusal (503) or a gateway failure mid-answer (`assistant-unavailable`)
 * stores nothing and switches the panel to help search (`unavailable`), with the question kept
 * to search for. A dropped stream keeps what came, to try again; a 429 says to wait.
 */
export function useConversation({
  declarationId,
  language,
  active,
}: {
  declarationId: string | null;
  language: AskLanguage;
  /** The panel has been opened at least once: the conversation is opened from then on. */
  active: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  // Each open is for a draft, a language and an attempt; until its answer comes, it is loading.
  const openKey = `${declarationId ?? 'outside'}|${language}|${String(attempt)}`;
  const [loaded, setLoaded] = useState<{ key: string; state: ConversationState } | null>(null);
  // A turn and the help search fallback belong to the conversation they were asked in: another
  // language or draft starts without them.
  const [pendingFor, setPendingFor] = useState<{ key: string; turn: PendingTurn | null }>({
    key: openKey,
    turn: null,
  });
  const [unavailableFor, setUnavailableFor] = useState<{
    key: string;
    question: string;
  } | null>(null);
  // Every turn asked here keeps its pending bubbles' keys once stored, so an answer is one
  // element from its first dots on and is never remounted by a later turn.
  const [turnKeys, setTurnKeys] = useState<ReadonlyMap<string, string>>(new Map());
  const turns = useRef(0);
  const pending = pendingFor.key === openKey ? pendingFor.turn : null;
  const unavailable =
    unavailableFor?.key === openKey ? { question: unavailableFor.question } : null;
  const answering = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    openAssistantConversation({ data: { declarationId, language } })
      .then((result) => {
        if (!current) return;
        // The session has ended: reloading signs the declarant in again and comes back here.
        if (result.status === 'unauthenticated') {
          window.location.reload();
          return;
        }
        setLoaded({
          key: openKey,
          state:
            result.status === 'ok'
              ? {
                  status: 'ready',
                  id: result.conversation.id,
                  messages: result.conversation.messages,
                  feedback: result.feedback,
                }
              : { status: 'failed' },
        });
      })
      .catch(() => {
        if (current) setLoaded({ key: openKey, state: { status: 'failed' } });
      });
    return () => {
      current = false;
    };
  }, [active, declarationId, language, openKey]);

  const conversation: ConversationState = !active
    ? { status: 'closed' }
    : loaded?.key === openKey
      ? loaded.state
      : { status: 'loading' };

  const setConversation = useCallback((update: (state: ConversationState) => ConversationState) => {
    setLoaded((current) => (current ? { ...current, state: update(current.state) } : current));
  }, []);

  const conversationId = conversation.status === 'ready' ? conversation.id : null;

  const ask = useCallback(
    async (question: string, context: AskContext) => {
      if (!conversationId || answering.current) return;
      const controller = new AbortController();
      answering.current = controller;
      turns.current += 1;
      const turn = turns.current;
      const setPending = (next: Omit<PendingTurn, 'turn' | 'question'> | null) => {
        setPendingFor({ key: openKey, turn: next ? { turn, question, ...next } : null });
      };
      const setUnavailable = () => {
        setPendingFor({ key: openKey, turn: null });
        setUnavailableFor({ key: openKey, question });
      };
      setPending({ status: 'thinking', text: '' });
      let text = '';
      const stopped = () => {
        setPending({ status: 'error', text });
      };
      try {
        const response = await fetch(answerUrl(conversationId), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({ text: question, sectionKey: context.sectionKey, itemType: null }),
          signal: controller.signal,
        });
        if (response.status === 401) {
          window.location.reload();
          return;
        }
        if (response.status === 429) {
          const body = (await response.json().catch(() => null)) as {
            retryAfterSeconds?: unknown;
          } | null;
          const seconds = Number(body?.retryAfterSeconds);
          setPending({
            status: 'rate-limited',
            text: '',
            ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: seconds } : {}),
          });
          return;
        }
        if (response.status === 503) {
          setUnavailable();
          return;
        }
        if (!response.ok || !response.body) {
          stopped();
          return;
        }
        for await (const frame of readAnswerStream(response.body)) {
          if (frame.event === 'delta') {
            text += frame.text;
            setPending({ status: 'streaming', text });
          } else if (frame.event === 'final') {
            setConversation((state) =>
              state.status === 'ready'
                ? { ...state, messages: [...state.messages, frame.question, frame.answer] }
                : state,
            );
            setTurnKeys(
              (keys) =>
                new Map([
                  ...keys,
                  [frame.question.id, turnKey(turn, 'question')],
                  [frame.answer.id, turnKey(turn, 'answer')],
                ]),
            );
            setPending(null);
          } else if (frame.code === 'assistant-unavailable') {
            setUnavailable();
          } else {
            stopped();
          }
        }
      } catch {
        stopped();
      } finally {
        if (answering.current === controller) answering.current = null;
      }
    },
    [conversationId, openKey, setConversation],
  );

  // Leaving the page, or another conversation opening, ends an answer still on its way; the
  // service then stores nothing.
  useEffect(
    () => () => {
      answering.current?.abort();
    },
    [openKey],
  );

  /** Ends an answer on its way (the panel closed): what came stays, to try again. */
  const stop = useCallback(() => {
    answering.current?.abort();
  }, []);

  const setRating = useCallback(
    (messageId: string, rating: AssistantMessage['rating']) => {
      setConversation((state) =>
        state.status === 'ready'
          ? {
              ...state,
              messages: state.messages.map((message) =>
                message.id === messageId ? { ...message, rating } : message,
              ),
            }
          : state,
      );
    },
    [setConversation],
  );

  return {
    conversation,
    pending,
    /** The key a stored message renders under: its turn's, or its id from history. */
    keyOf: useCallback(
      (message: AssistantMessage) => turnKeys.get(message.id) ?? message.id,
      [turnKeys],
    ),
    unavailable,
    ask,
    stop,
    setRating,
    /** Leaves help search for the conversation again. */
    resume: useCallback(() => {
      setUnavailableFor(null);
    }, []),
    clearPending: useCallback(() => {
      setPendingFor({ key: openKey, turn: null });
    }, [openKey]),
    reload: useCallback(() => {
      setAttempt((count) => count + 1);
    }, []),
  };
}
