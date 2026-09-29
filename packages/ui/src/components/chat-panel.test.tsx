import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatComposer } from './chat-composer';
import { ChatLog, ChatPanel } from './chat-panel';
import { SuggestedQuestions } from './suggested-questions';

describe('ChatPanel', () => {
  it('is a complementary landmark named by its heading', () => {
    render(
      <ChatPanel title="Ask Adili" onClose={vi.fn()}>
        <ChatLog />
      </ChatPanel>,
    );

    const panel = screen.getByRole('complementary', { name: 'Ask Adili' });
    expect(screen.getByRole('heading', { level: 2, name: 'Ask Adili' })).toBeDefined();
    expect(panel.contains(screen.getByRole('log', { name: 'Conversation' }))).toBe(true);
  });

  it('asks a suggested question from the idle panel', () => {
    const onAsk = vi.fn();
    render(
      <ChatPanel title="Ask Adili" footer={<ChatComposer onSend={onAsk} />}>
        <ChatLog>
          <p>Ask in your own words, in English or Kiswahili.</p>
          <SuggestedQuestions questions={['How do I value my land?']} onAsk={onAsk} />
        </ChatLog>
      </ChatPanel>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'How do I value my land?' }));

    expect(onAsk).toHaveBeenCalledWith('How do I value my land?');
    expect(screen.getByRole('textbox', { name: 'Ask about this section…' })).toBeDefined();
  });

  it('closes with its close button', () => {
    const onClose = vi.fn();
    render(<ChatPanel title="Ask Adili" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the meta row and the footer', () => {
    render(
      <ChatPanel
        title="Ask Adili"
        meta={<span>AI-assisted · not legal advice</span>}
        footer={<p>Adili does not read your amounts.</p>}
      />,
    );

    expect(screen.getByText('AI-assisted · not legal advice')).toBeDefined();
    expect(screen.getByText('Adili does not read your amounts.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('shows a grab handle as a bottom sheet', () => {
    const { container } = render(<ChatPanel title="Ask Adili" variant="sheet" />);

    expect(container.querySelector('[data-grab]')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ChatLog', () => {
  it('is a log that does not read out every streamed word', () => {
    render(<ChatLog />);

    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('off');
    expect(log.tabIndex).toBe(0);
  });

  function scrollable(log: HTMLElement, scrollHeight: number) {
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
  }

  it('follows new text while the reader is at the bottom', async () => {
    const { rerender } = render(
      <ChatLog>
        <p>First</p>
      </ChatLog>,
    );
    const log = screen.getByRole('log');
    scrollable(log, 1000);
    log.scrollTop = 700;
    fireEvent.scroll(log);

    scrollable(log, 1400);
    rerender(
      <ChatLog>
        <p>First, and more</p>
      </ChatLog>,
    );
    await act(() => Promise.resolve());

    expect(log.scrollTop).toBe(1400);
  });

  it('stays put when the reader has scrolled up', async () => {
    const { rerender } = render(
      <ChatLog>
        <p>First</p>
      </ChatLog>,
    );
    const log = screen.getByRole('log');
    scrollable(log, 1000);
    log.scrollTop = 200;
    fireEvent.scroll(log);

    scrollable(log, 1400);
    rerender(
      <ChatLog>
        <p>First, and more</p>
      </ChatLog>,
    );
    await act(() => Promise.resolve());

    expect(log.scrollTop).toBe(200);
  });
});
