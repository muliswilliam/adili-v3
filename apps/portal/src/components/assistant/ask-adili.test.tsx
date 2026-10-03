// @vitest-environment jsdom
import { TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  openAssistantConversation,
  rateAssistantAnswer,
  searchAssistantHelp,
} from '../../server/assistant';
import { getDeclarationSummary } from '../../server/declarations';
import type { LoadedSummary } from '../../server/declarations.server';
import type {
  AssistantConversation,
  AssistantMessage,
  DeclarationSection,
} from '../../server/declarations/types';
import { AskAdiliLauncher, AskAdiliProvider } from './ask-adili';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../server/declarations', () => ({ getDeclarationSummary: vi.fn() }));
vi.mock('../../server/assistant', () => ({
  openAssistantConversation: vi.fn(),
  rateAssistantAnswer: vi.fn(),
  searchAssistantHelp: vi.fn(),
}));

const openMock = vi.mocked(openAssistantConversation);
const rateMock = vi.mocked(rateAssistantAnswer);
const searchMock = vi.mocked(searchAssistantHelp);
const summaryMock = vi.mocked(getDeclarationSummary);

const DRAFT = '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a';
const CONVERSATION = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SECTIONS: DeclarationSection[] = [
  { key: 'bio', completeness: 'complete', updatedAt: null, personName: null },
  { key: 'household', completeness: 'complete', updatedAt: null, personName: null },
  {
    key: 'statement:officer',
    completeness: 'incomplete',
    updatedAt: null,
    personName: 'John Kamau',
  },
  { key: 'other', completeness: 'complete', updatedAt: null, personName: null },
];

const LABEL = {
  aiAssisted: true as const,
  task: 'answer-declarant-question' as const,
  promptVersion: 1,
  provider: 'anthropic',
  model: 'claude-opus-5',
  generatedAt: '2026-10-03T09:00:00Z',
  disclaimer: 'Not legal advice.',
};

function msg(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    text: '',
    citations: [],
    sectionLink: null,
    declined: false,
    reportingOfficer: null,
    label: null,
    rating: null,
    at: '2026-10-03T09:00:00Z',
    ...overrides,
  };
}

const QUESTION = 'How do I value my car?';
const ANSWER_TEXT =
  'Give an approximate value as at the statement date. You do not need a professional valuation.';
const answer = msg({
  text: ANSWER_TEXT,
  citations: [
    {
      id: 'am-24',
      source: 'am',
      citation: 'AM 24',
      title: 'Approximate values',
      snippet: 'Declare approximate values as at the statement date.',
      language: 'en',
    },
  ],
  sectionLink: { sectionKey: 'statement:officer', fieldPath: '/assets/0/value' },
  label: LABEL,
});
const question = msg({ role: 'user', text: QUESTION });

function conversation(overrides: Partial<AssistantConversation> = {}): AssistantConversation {
  return {
    id: CONVERSATION,
    declarationId: DRAFT,
    language: 'en',
    messages: [],
    expiresAt: null,
    ...overrides,
  };
}

/** A stream the test feeds frame by frame. */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    // node:stream/web's stream (jsdom has none) is typed apart from the DOM's BodyInit.
    response: new Response(body as unknown as BodyInit, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    send(event: string, data: unknown) {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    close() {
      controller.close();
    },
  };
}

const fetchMock = vi.fn<typeof fetch>();

function renderPanel({
  declarationId = DRAFT,
  step = 'statement:officer',
}: { declarationId?: string | null; step?: string } = {}) {
  return render(
    <TooltipProvider>
      <AskAdiliProvider declarationId={declarationId} sections={SECTIONS} step={step}>
        <AskAdiliLauncher />
      </AskAdiliProvider>
    </TooltipProvider>,
  );
}

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Ask Adili' }));
  return screen.findByRole('complementary', { name: 'Ask Adili' });
}

function ask(text: string) {
  const box = screen.getByRole('textbox', { name: 'Ask about this section…' });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', fetchMock);
  openMock.mockResolvedValue({ status: 'ok', conversation: conversation() });
  searchMock.mockResolvedValue({ status: 'ok', passages: [] });
  summaryMock.mockResolvedValue({ status: 'unavailable' });
  rateMock.mockResolvedValue({ status: 'rated' });
});

describe('Ask Adili panel (S12)', () => {
  it('opens on the section with suggested questions, the AI label and the privacy line', async () => {
    renderPanel();
    const panel = await openPanel();

    expect(openMock).toHaveBeenCalledWith({ data: { declarationId: DRAFT, language: 'en' } });
    expect(await within(panel).findByText('Suggested questions')).toBeTruthy();
    expect(
      within(panel).getByRole('button', { name: "Do I declare my wife's salary?" }),
    ).toBeTruthy();
    expect(
      within(panel).getByRole('img', { name: /^AI-assisted · not legal advice/ }),
    ).toBeTruthy();
    expect(within(panel).getByText('On: Income')).toBeTruthy();
    expect(
      within(panel).getByText(/Adili does not read your amounts, names or ID numbers/),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      within(panel).getByRole('textbox', { name: 'Ask about this section…' }),
    );
  });

  it('streams an answer, then shows its citations, section link and feedback (S2)', async () => {
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');

    ask(QUESTION);
    expect(within(panel).getByText(QUESTION)).toBeTruthy();
    expect((await within(panel).findAllByText('Adili is answering…')).length).toBeGreaterThan(0);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/assistant/conversations/${CONVERSATION}/messages`);
    expect(JSON.parse(init?.body as string)).toEqual({
      text: QUESTION,
      sectionKey: 'statement:officer',
      itemType: null,
    });

    act(() => {
      stream.send('delta', { text: 'Give an approximate ' });
    });
    await waitFor(() => {
      expect(panel.querySelector('[data-status="streaming"]')?.textContent).toContain(
        'Give an approximate',
      );
    });
    expect(within(panel).getByRole('textbox', { name: 'Ask about this section…' })).toBeTruthy();

    act(() => {
      stream.send('final', { question, answer });
      stream.close();
    });
    expect(await within(panel).findByText(ANSWER_TEXT, { exact: false })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'AM 24' })).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'AM 24' }));
    expect(
      within(panel).getByText('Declare approximate values as at the statement date.'),
    ).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Helpful' }));
    await waitFor(() => {
      expect(rateMock).toHaveBeenCalledWith({
        data: {
          conversationId: CONVERSATION,
          messageId: answer.id,
          rating: 'helpful',
          reason: null,
          note: null,
        },
      });
    });
  });

  it('opens the section and the field the answer links to', async () => {
    openMock.mockResolvedValue({
      status: 'ok',
      conversation: conversation({ messages: [question, answer] }),
    });
    renderPanel();
    const panel = await openPanel();
    fireEvent.click(await within(panel).findByRole('button', { name: 'Open Assets → value' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/declarations/$id/statements/$personKey',
      params: { id: DRAFT, personKey: 'officer' },
      search: { field: '/assets/0/value' },
    });
  });

  it("declines with the reporting officer's contact (S3)", async () => {
    const declined = msg({
      text: 'I could not find this in the Act or Regulations. Ask your reporting officer.',
      declined: true,
      reportingOfficer: { name: 'Joseph Kiplagat', email: 'ro@tsc.go.ke', phone: null },
    });
    openMock.mockResolvedValue({
      status: 'ok',
      conversation: conversation({ messages: [question, declined] }),
    });
    renderPanel();
    const panel = await openPanel();
    expect(
      await within(panel).findByText(
        'I could not find this in the Act or Regulations. Ask your reporting officer:',
      ),
    ).toBeTruthy();
    expect(within(panel).getByText('Joseph Kiplagat')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'ro@tsc.go.ke' })).toBeTruthy();
    expect(within(panel).getByRole('group', { name: 'Rate this answer' })).toBeTruthy();
  });

  it('switches to Kiswahili: the panel words and the conversation (S4)', async () => {
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    openMock.mockResolvedValue({ status: 'ok', conversation: conversation({ language: 'sw' }) });

    fireEvent.click(within(panel).getByRole('button', { name: 'Kiswahili' }));

    const swahili = await screen.findByRole('complementary', { name: 'Uliza Adili' });
    expect(openMock).toHaveBeenLastCalledWith({ data: { declarationId: DRAFT, language: 'sw' } });
    expect(await within(swahili).findByText('Maswali yanayopendekezwa')).toBeTruthy();
    expect(within(swahili).getByRole('textbox', { name: 'Uliza kuhusu sehemu hii…' })).toBeTruthy();
    expect(within(swahili).getByText(/Adili haisomi kiasi/)).toBeTruthy();
    expect(
      within(swahili).getByRole('button', { name: 'Kiswahili' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('says a declarant who asks too often to wait (429)', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: 'rate-limited', retryAfterSeconds: 60 }, { status: 429 }),
    );
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    ask(QUESTION);
    expect(
      await within(panel).findByText(
        'You have asked many questions in a short time. Try again in a minute.',
      ),
    ).toBeTruthy();
  });

  it('offers Try again when the stream drops part-way', async () => {
    const stream = controlledStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    ask(QUESTION);
    act(() => {
      stream.send('delta', { text: 'Give an approximate ' });
      stream.close();
    });
    expect(await within(panel).findByText('The answer stopped before it finished.')).toBeTruthy();

    const again = controlledStream();
    fetchMock.mockResolvedValueOnce(again.response);
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    act(() => {
      again.send('final', { question, answer });
      again.close();
    });
    expect(await within(panel).findByText(ANSWER_TEXT, { exact: false })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to help search when answers are unavailable (503)', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'unavailable' }, { status: 503 }));
    searchMock.mockResolvedValue({
      status: 'ok',
      passages: [
        {
          id: 'help-value',
          source: 'help',
          citation: 'Help: Valuing assets',
          title: 'Valuing assets',
          snippet: 'Use what the asset would sell for on the statement date.',
          language: 'en',
        },
      ],
    });
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    ask(QUESTION);

    expect(
      await within(panel).findByText('Answers are unavailable right now. Search the help instead.'),
    ).toBeTruthy();
    const search = within(panel).getByRole('searchbox', { name: 'Search the help' });
    expect((search as HTMLInputElement).value).toBe(QUESTION);
    expect(await within(panel).findByText('Valuing assets')).toBeTruthy();
    expect(searchMock).toHaveBeenCalledWith({
      data: { q: QUESTION, language: 'en', sectionKey: 'statement:officer' },
    });
    expect(within(panel).queryByRole('textbox', { name: 'Ask about this section…' })).toBeNull();
  });

  it('lists what is still missing, with the deterministic text, when answers are unavailable', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'unavailable' }, { status: 503 }));
    summaryMock.mockResolvedValue({
      status: 'ok',
      summary: {
        blocking: [
          {
            sectionKey: 'statement:officer',
            path: '/assets/0/value',
            code: 'required',
            message: 'Enter the approximate value.',
          },
        ],
        document: {},
      } as unknown as LoadedSummary,
    });
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    ask(QUESTION);

    expect(await within(panel).findByText('Still missing (1)')).toBeTruthy();
    expect(within(panel).getByText('Enter the approximate value.')).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Fix: Enter the approximate value.' }),
    );
    expect(navigate).toHaveBeenCalledWith({
      to: '/declarations/$id/statements/$personKey',
      params: { id: DRAFT, personKey: 'officer' },
      search: { field: '/assets/0/value' },
    });
  });

  it('falls back to help search when the answer fails with assistant-unavailable', async () => {
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    ask(QUESTION);
    act(() => {
      stream.send('delta', { text: 'Give ' });
      stream.send('error', { code: 'assistant-unavailable' });
      stream.close();
    });
    expect(
      await within(panel).findByText('Answers are unavailable right now. Search the help instead.'),
    ).toBeTruthy();
  });

  it('offers help search when the conversation cannot be opened', async () => {
    openMock.mockResolvedValue({ status: 'unavailable' });
    renderPanel();
    const panel = await openPanel();
    expect(
      await within(panel).findByText('Answers are unavailable right now. Search the help instead.'),
    ).toBeTruthy();
    expect(within(panel).getByRole('searchbox', { name: 'Search the help' })).toBeTruthy();

    openMock.mockResolvedValue({ status: 'ok', conversation: conversation() });
    fireEvent.click(within(panel).getByRole('button', { name: 'Ask Adili again' }));
    expect(await within(panel).findByText('Suggested questions')).toBeTruthy();
  });

  it('keeps the language while an answer is on its way', async () => {
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    ask(QUESTION);
    await within(panel).findAllByText('Adili is answering…');
    expect(
      within(panel).getByRole<HTMLButtonElement>('button', { name: 'Kiswahili' }).disabled,
    ).toBe(true);
    act(() => {
      stream.send('final', { question, answer });
      stream.close();
    });
    await within(panel).findByText(ANSWER_TEXT, { exact: false });
    expect(
      within(panel).getByRole<HTMLButtonElement>('button', { name: 'Kiswahili' }).disabled,
    ).toBe(false);
  });

  it('labels the panel with the latest answer, not an older one', async () => {
    const declined = msg({ text: 'I could not find this.', declined: true });
    openMock.mockResolvedValue({
      status: 'ok',
      conversation: conversation({
        messages: [question, answer, question, declined].map((m, i) => ({
          ...m,
          id: `${m.id}-${String(i)}`,
        })),
      }),
    });
    renderPanel();
    const panel = await openPanel();
    const label = await within(panel).findByRole('img', {
      name: /^AI-assisted · not legal advice/,
    });
    expect(label.getAttribute('aria-label')).not.toContain('claude-opus-5');
  });

  it('opens outside a draft on the dashboard, without section links', async () => {
    openMock.mockResolvedValue({
      status: 'ok',
      conversation: conversation({
        declarationId: null,
        expiresAt: '2026-11-02T09:00:00Z',
      }),
    });
    renderPanel({ declarationId: null, step: 'home' });
    const panel = await openPanel();
    expect(openMock).toHaveBeenCalledWith({ data: { declarationId: null, language: 'en' } });
    expect(
      await within(panel).findByRole('button', { name: 'When is my declaration due?' }),
    ).toBeTruthy();
    expect(within(panel).getByText('On: Home')).toBeTruthy();
  });

  it('rises as a modal sheet on phones, keeping Tab inside it', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Adili' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ask Adili' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    const send = await within(sheet).findByRole('button', { name: 'Send' });
    send.focus();
    fireEvent.keyDown(send, { key: 'Tab' });
    expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: /Kept with/ }));
  });

  it('closes with Escape and gives focus back to the launcher', async () => {
    renderPanel();
    const panel = await openPanel();
    await within(panel).findByText('Suggested questions');
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Ask Adili' })).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask Adili' }));
  });
});
