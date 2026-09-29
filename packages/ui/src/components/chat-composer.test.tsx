import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChatComposer } from './chat-composer';

const input = () => screen.getByRole('textbox', { name: 'Ask about this section…' });

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

describe('ChatComposer', () => {
  it('sends the question on Enter and clears the box', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    type('  How do I value my car?  ');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('How do I value my car?');
    expect((input() as HTMLTextAreaElement).value).toBe('');
  });

  it('adds a line on Shift+Enter', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    type('First line');
    const allowed = fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });

    expect(allowed).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send while an input method is composing', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    type('habari');
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send on the Enter that ends a composition in Safari', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    type('habari');
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends with the Send button', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    type('Who do I declare for?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('Who do I declare for?');
  });

  it('sends nothing blank', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    type('   ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the question while an answer is on its way', () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} busy />);

    type('And for land?');
    fireEvent.keyDown(input(), { key: 'Enter' });
    const send = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(send);

    expect(onSend).not.toHaveBeenCalled();
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect((input() as HTMLTextAreaElement).value).toBe('And for land?');
  });

  it('takes at most 2,000 characters', () => {
    render(<ChatComposer onSend={vi.fn()} />);

    expect(input().getAttribute('maxlength')).toBe('2000');
  });

  it('can be controlled, so a draft survives closing the panel', () => {
    const onSend = vi.fn();
    function Controlled() {
      const [draft, setDraft] = useState('Kept draft');
      return <ChatComposer value={draft} onValueChange={setDraft} onSend={onSend} />;
    }
    render(<Controlled />);

    expect((input() as HTMLTextAreaElement).value).toBe('Kept draft');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('Kept draft');
    expect((input() as HTMLTextAreaElement).value).toBe('');
  });
});
