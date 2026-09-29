import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssistantMessage, nextAnnouncement, UserMessage } from './chat-message';
import type { Citation } from './citation-chip';

const CITATIONS: Citation[] = [
  {
    id: 'am-24',
    source: 'am',
    citation: 'AM 24',
    title: 'Approximate values',
    snippet: 'Declare approximate values as at the statement date.',
  },
  {
    id: 'help-value',
    source: 'help',
    citation: 'Help: Valuing assets',
    title: 'Valuing assets',
    snippet: 'Use what the asset would sell for on the statement date.',
  },
];

const OFFICER = { name: 'Joseph Kiplagat', email: 'ro@tsc.go.ke', phone: '020 289 2000' };

const status = () => screen.getByRole('status').textContent;

describe('nextAnnouncement', () => {
  it('says nothing until a sentence ends', () => {
    expect(nextAnnouncement('Yes. A vehicle you own', 0, false)).toEqual({
      text: 'Yes.',
      announced: 5,
    });
    expect(nextAnnouncement('A vehicle you own with someone', 0, false)).toEqual({
      text: '',
      announced: 0,
    });
  });

  it('reads each finished sentence once', () => {
    const text = 'Yes. A vehicle you own with someone else is an asset. Declare it';

    expect(nextAnnouncement(text, 5, false)).toEqual({
      text: 'A vehicle you own with someone else is an asset.',
      announced: 54,
    });
    expect(nextAnnouncement(text, 54, false)).toEqual({ text: '', announced: 54 });
  });

  it('waits for the space after a stop, so "s.31" and "3.5" are not cut', () => {
    expect(nextAnnouncement('See Act s.', 0, false)).toEqual({ text: '', announced: 0 });
    expect(nextAnnouncement('See Act s.31(4). It', 0, false)).toEqual({
      text: 'See Act s.31(4).',
      announced: 17,
    });
  });

  it('ends a sentence at ?, ! or a closing quote', () => {
    expect(nextAnnouncement('Is it joint? Say "yes." Then', 0, false)).toEqual({
      text: 'Is it joint? Say "yes."',
      announced: 24,
    });
  });

  it('reads what is left once the answer is finished', () => {
    expect(nextAnnouncement('Yes. Declare it under Assets', 5, true)).toEqual({
      text: 'Declare it under Assets',
      announced: 28,
    });
  });

  it('starts again when the text is replaced by a shorter one', () => {
    expect(nextAnnouncement('Hi. There', 40, false)).toEqual({ text: 'Hi.', announced: 4 });
  });
});

describe('AssistantMessage', () => {
  it('announces that Adili is answering, then each finished sentence, then the rest', () => {
    const { rerender } = render(<AssistantMessage status="thinking" />);
    expect(status()).toBe('Adili is answering…');

    rerender(<AssistantMessage status="streaming" text="Yes. A vehicle you own" />);
    expect(status()).toBe('Yes.');

    rerender(<AssistantMessage status="streaming" text="Yes. A vehicle you own with someone" />);
    expect(status()).toBe('Yes.');

    rerender(<AssistantMessage status="streaming" text="Yes. A vehicle is an asset. Declare" />);
    expect(status()).toBe('A vehicle is an asset.');

    rerender(<AssistantMessage status="answered" text="Yes. A vehicle is an asset. Declare it" />);
    expect(status()).toBe('Declare it');
  });

  it('keeps the bubble out of the live region, with a caret while streaming', () => {
    const { container } = render(<AssistantMessage status="streaming" text="Yes. A vehicle" />);

    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('.animate-caret')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks only the bubble busy, so the live region is not held back', () => {
    const { container } = render(<AssistantMessage status="streaming" text="Yes. A vehicle" />);

    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy?.textContent).toBe('Adili: Yes. A vehicle');
    expect(busy?.contains(screen.getByRole('status'))).toBe(false);
  });

  it('says nothing for an answer loaded from history', () => {
    render(<AssistantMessage status="answered" text="Give an approximate value." />);

    expect(status()).toBe('');
    expect(screen.getByText('Give an approximate value.')).toBeDefined();
  });

  it('shows citation chips and actions once answered', () => {
    render(
      <AssistantMessage
        status="answered"
        text="Give an approximate value."
        citations={CITATIONS}
        actions={<button type="button">Open Assets</button>}
      />,
    );

    const sources = screen.getByRole('list', { name: 'Sources' });
    expect(within(sources).getByRole('button', { name: 'AM 24' })).toBeDefined();
    expect(within(sources).getByRole('button', { name: 'Help: Valuing assets' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open Assets' })).toBeDefined();
  });

  it('shows no chips or actions while streaming', () => {
    render(
      <AssistantMessage
        status="streaming"
        text="Give an"
        citations={CITATIONS}
        actions={<button type="button">Open Assets</button>}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
  });

  it("declines with the reporting officer's contact, and announces it", () => {
    const { rerender } = render(<AssistantMessage status="thinking" />);
    rerender(<AssistantMessage status="declined" officer={OFFICER} />);

    expect(status()).toBe(
      'I could not find this in the Act or Regulations. Ask your reporting officer: Joseph Kiplagat',
    );
    expect(screen.getByRole('link', { name: 'ro@tsc.go.ke' }).getAttribute('href')).toBe(
      'mailto:ro@tsc.go.ke',
    );
    expect(screen.getByRole('link', { name: '020 289 2000' }).getAttribute('href')).toBe(
      'tel:0202892000',
    );
  });

  it('keeps what streamed when the answer stops, and offers Try again', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AssistantMessage status="streaming" text="Yes. A vehicle" />);
    rerender(<AssistantMessage status="error" text="Yes. A vehicle" onRetry={onRetry} />);

    expect(status()).toBe('The answer stopped before it finished.');
    expect(screen.getByText('Yes. A vehicle…')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says when too many questions were asked', () => {
    render(<AssistantMessage status="rate-limited" />);

    expect(status()).toBe('You have asked many questions in a short time. Try again in a minute.');
  });

  it('takes other copy', () => {
    render(
      <AssistantMessage
        status="thinking"
        messages={{ answering: 'Adili inajibu…', assistantName: 'Adili' }}
      />,
    );

    expect(status()).toBe('Adili inajibu…');
  });
});

describe('UserMessage', () => {
  it('names who asked for screen readers', () => {
    render(<UserMessage text="How do I value my car?" />);

    expect(screen.getByText('How do I value my car?').textContent).toBe(
      'You: How do I value my car?',
    );
  });
});
