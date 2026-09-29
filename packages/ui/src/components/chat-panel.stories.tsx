import type { Meta, StoryObj } from '@storybook/react-vite';
import { File01Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { AiLabel, type AiLabelDetails } from './ai-label';
import { Button } from './button';
import { ChatComposer } from './chat-composer';
import { AssistantMessage, type AssistantMessageStatus, UserMessage } from './chat-message';
import { ChatLog, ChatPanel } from './chat-panel';
import type { Citation } from './citation-chip';
import { type Feedback, FeedbackControl } from './feedback-control';
import { Icon } from './icon';
import { SuggestedQuestions } from './suggested-questions';

const LABEL: AiLabelDetails = {
  task: 'answer-declarant-question',
  provider: 'anthropic',
  model: 'claude-opus-5',
  promptVersion: 2,
  generatedAt: '2026-09-29T09:12:00Z',
};

const SUGGESTED = [
  'Do I declare a car I own with my brother?',
  'How do I value my land?',
  'Do I include my SACCO shares?',
];

const QUESTION = 'Do I declare a car I own with my brother?';

const ANSWER =
  'Yes. A vehicle you own with someone else is an asset. Declare it under Assets at its whole value, switch on "Jointly held" and enter your share, for example 50%.';

const CITATIONS: Citation[] = [
  {
    id: 'fs-8',
    source: 'act',
    citation: 'First Schedule, para 8',
    title: 'Jointly held assets',
    snippet:
      'Assets held jointly with another person shall be declared, stating the share held by the declarant.',
  },
  {
    id: 'help-joint',
    source: 'help',
    citation: 'Help: Joint assets',
    title: 'Joint assets',
    snippet:
      'If you own an asset with someone else, declare it once in your statement at its whole value. Switch on "Jointly held" and enter your share, for example 50%.',
  },
];

const OFFICER = {
  name: 'Joseph Kiplagat',
  email: 'reporting.officer@tsc.go.ke',
  phone: '020 289 2000',
};

interface Turn {
  question: string;
  status: AssistantMessageStatus;
  text: string;
}

function Rating() {
  const [value, setValue] = useState<Feedback | null>(null);
  return (
    <FeedbackControl
      value={value}
      onRate={setValue}
      noteMaxLength={500}
      messages={{ group: 'Rate this answer' }}
      className="items-start"
    />
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="h-[640px] max-w-[392px] border bg-background">{children}</div>;
}

/**
 * The Ask Adili panel as the portal builds it. With `simulate`, a question sent streams the
 * answer word by word, so the live region's sentence-by-sentence reading can be tried.
 */
function AskAdili({
  turn: initial,
  simulate = false,
  variant,
}: {
  turn: Turn | null;
  simulate?: boolean;
  variant?: 'side' | 'sheet';
}) {
  const [turn, setTurn] = useState(initial);
  const [lang, setLang] = useState<'en' | 'sw'>('en');
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(
    () => () => {
      clearInterval(timer.current);
    },
    [],
  );

  function ask(question: string) {
    if (!simulate) return;
    const words = ANSWER.split(/(\s+)/);
    let next = 0;
    setTurn({ question, status: 'thinking', text: '' });
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      next += 1;
      const done = next >= words.length;
      if (done) clearInterval(timer.current);
      setTurn({
        question,
        status: done ? 'answered' : 'streaming',
        text: words.slice(0, next).join(''),
      });
    }, 60);
  }

  const busy = turn?.status === 'thinking' || turn?.status === 'streaming';

  return (
    <ChatPanel
      title="Ask Adili"
      variant={variant}
      onClose={() => undefined}
      meta={
        <>
          <AiLabel details={LABEL} text="AI-assisted · not legal advice" />
          <div role="group" aria-label="Language" className="inline-flex gap-0.5">
            {(['en', 'sw'] as const).map((code) => (
              <Button
                key={code}
                size="xs"
                variant={lang === code ? 'secondary' : 'ghost'}
                aria-pressed={lang === code}
                onClick={() => {
                  setLang(code);
                }}
              >
                {code === 'en' ? 'English' : 'Kiswahili'}
              </Button>
            ))}
          </div>
        </>
      }
      footer={
        <>
          <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground [&_svg]:size-[13px]">
            <Icon icon={File01Icon} /> On: Assets
          </p>
          <ChatComposer onSend={ask} busy={busy} />
          <p className="text-xs leading-[1.45] text-muted-foreground">
            Adili does not read your amounts, names or ID numbers. It knows which section you are on
            and what is still missing.
          </p>
        </>
      }
    >
      <ChatLog>
        {turn ? (
          <>
            <UserMessage text={turn.question} />
            <AssistantMessage
              status={turn.status}
              text={turn.text}
              citations={CITATIONS}
              officer={OFFICER}
              onRetry={() => {
                ask(turn.question);
              }}
              onReadPassage={() => undefined}
              actions={
                turn.status === 'answered' ? (
                  <>
                    <Button variant="secondary" size="sm">
                      Open Assets
                    </Button>
                    <Rating />
                  </>
                ) : (
                  <Rating />
                )
              }
            />
          </>
        ) : (
          <>
            <p className="text-sm text-secondary-foreground">
              Ask in your own words, in English or Kiswahili.
            </p>
            <SuggestedQuestions questions={SUGGESTED} onAsk={ask} />
          </>
        )}
      </ChatLog>
    </ChatPanel>
  );
}

const meta = {
  title: 'AI/ChatPanel',
  component: AskAdili,
  args: { turn: null },
  decorators: [
    (Story) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
} satisfies Meta<typeof AskAdili>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing asked yet: the suggested questions for the section. Send one to watch it stream. */
export const Idle: Story = { args: { simulate: true } };

export const Streaming: Story = {
  args: {
    turn: {
      question: QUESTION,
      status: 'streaming',
      text: 'Yes. A vehicle you own with someone else is an asset. Declare it under',
    },
  },
};

export const Answered: Story = {
  args: { turn: { question: QUESTION, status: 'answered', text: ANSWER } },
};

export const Declined: Story = {
  args: {
    turn: { question: 'Can my employer see my declaration?', status: 'declined', text: '' },
  },
};

export const StreamError: Story = {
  args: {
    turn: {
      question: QUESTION,
      status: 'error',
      text: 'Yes. A vehicle you own with someone else is an asset. Declare it under',
    },
    simulate: true,
  },
};

/** On phones the panel rises from the bottom with a grab handle. */
export const Sheet: Story = { args: { simulate: true, variant: 'sheet' } };
