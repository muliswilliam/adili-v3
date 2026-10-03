import { type AssistantMessageStatus } from '@adili/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AskLanguage } from '../../assistant/copy';
import { readAnswerStream } from '../../assistant/stream';
import { openAssistantConversation } from '../../server/assistant';
import type { AssistantMessage } from '../../server/declarations/types';

/** The question being answered, and how far its answer got. */
export interface PendingTurn {
  question: string;
  status: Extract<AssistantMessageStatus, 'thinking' | 'streaming' | 'error' | 'rate-limited'>;
  text: string;
}

export type ConversationState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; id: string; messages: AssistantMessage[] };

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
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [unavailable, setUnavailable] = useState<{ question: string } | null>(null);
  const answering = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    openAssistantConversation({ data: { declarationId, language } })
      .then((result) => {
        if (!current) return;
        setLoaded({
          key: openKey,
          state:
            result.status === 'ok'
              ? {
                  status: 'ready',
                  id: result.conversation.id,
                  messages: result.conversation.messages,
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

  // Leaving the page ends the answer; the service then stores nothing.
  useEffect(
    () => () => {
      answering.current?.abort();
    },
    [],
  );

  const conversationId = conversation.status === 'ready' ? conversation.id : null;

  const ask = useCallback(
    async (question: string, context: AskContext) => {
      if (!conversationId || answering.current) return;
      const controller = new AbortController();
      answering.current = controller;
      setPending({ question, status: 'thinking', text: '' });
      let text = '';
      const stopped = () => {
        setPending({ question, status: 'error', text });
      };
      try {
        const response = await fetch(answerUrl(conversationId), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({ text: question, sectionKey: context.sectionKey, itemType: null }),
          signal: controller.signal,
        });
        if (response.status === 429) {
          setPending({ question, status: 'rate-limited', text: '' });
          return;
        }
        if (response.status === 503) {
          setPending(null);
          setUnavailable({ question });
          return;
        }
        if (!response.ok || !response.body) {
          stopped();
          return;
        }
        for await (const frame of readAnswerStream(response.body)) {
          if (frame.event === 'delta') {
            text += frame.text;
            setPending({ question, status: 'streaming', text });
          } else if (frame.event === 'final') {
            setConversation((state) =>
              state.status === 'ready'
                ? { ...state, messages: [...state.messages, frame.question, frame.answer] }
                : state,
            );
            setPending(null);
          } else if (frame.code === 'assistant-unavailable') {
            setPending(null);
            setUnavailable({ question });
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
    [conversationId, setConversation],
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
    unavailable,
    ask,
    stop,
    setRating,
    /** Leaves help search for the conversation again. */
    resume: useCallback(() => {
      setUnavailable(null);
    }, []),
    clearPending: useCallback(() => {
      setPending(null);
    }, []),
    reload: useCallback(() => {
      setAttempt((count) => count + 1);
    }, []),
  };
}
