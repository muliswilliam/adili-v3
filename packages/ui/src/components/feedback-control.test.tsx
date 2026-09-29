import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { type Feedback, FeedbackControl, type FeedbackControlProps } from './feedback-control';

// jsdom lacks the pointer capture and scrolling APIs Radix Select calls.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

/** Keeps the rating the way a panel would, once the server accepted it. */
function Rated({
  initial = null,
  onRate = vi.fn(),
  ...props
}: Partial<FeedbackControlProps> & {
  initial?: Feedback | null;
  onRate?: (feedback: Feedback) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <FeedbackControl
      value={value}
      onRate={async (feedback) => {
        await onRate(feedback);
        setValue(feedback);
      }}
      {...props}
    />
  );
}

/** Clicks and lets the save settle. */
async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

const helpful = () => screen.getByRole('button', { name: 'Helpful' });
const notHelpful = () => screen.getByRole('button', { name: 'Not helpful' });

function pickReason(name: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'What was wrong?' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('FeedbackControl', () => {
  it('starts unrated, with two labelled buttons in a named group', () => {
    render(<Rated />);

    expect(screen.getByRole('group', { name: 'Rate this output' })).toBeDefined();
    expect(helpful().getAttribute('aria-pressed')).toBe('false');
    expect(notHelpful().getAttribute('aria-pressed')).toBe('false');
    expect(notHelpful().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('rates helpful in one press and says so', async () => {
    const onRate = vi.fn();
    render(<Rated onRate={onRate} />);

    await press(helpful());

    expect(onRate).toHaveBeenCalledWith({ rating: 'helpful', reason: null, note: null });
    expect(helpful().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Rating sent. Thank you.');
  });

  it('does not send the same helpful rating twice', () => {
    const onRate = vi.fn();
    render(<Rated initial={{ rating: 'helpful', reason: null, note: null }} onRate={onRate} />);

    fireEvent.click(helpful());

    expect(onRate).not.toHaveBeenCalled();
  });

  it('asks why before sending not helpful, and sends the reason and note', async () => {
    const onRate = vi.fn();
    render(<Rated onRate={onRate} />);

    fireEvent.click(notHelpful());

    expect(onRate).not.toHaveBeenCalled();
    expect(notHelpful().getAttribute('aria-expanded')).toBe('true');
    expect(notHelpful().getAttribute('aria-pressed')).toBe('true');
    const form = screen.getByRole('form', { name: 'Why was this not helpful?' });
    expect(notHelpful().getAttribute('aria-controls')).toBe(form.id);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'What was wrong?' }));

    pickReason('Missed something');
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: '  It left out the second plot.  ' },
    });
    await press(screen.getByRole('button', { name: 'Send rating' }));

    expect(onRate).toHaveBeenCalledWith({
      rating: 'not-helpful',
      reason: 'missed-something',
      note: 'It left out the second plot.',
    });
    expect(screen.queryByRole('form')).toBeNull();
    expect(notHelpful().getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(notHelpful());
    expect(screen.getByRole('status').textContent).toBe('Rating sent. Thank you.');
  });

  it('requires a reason, and sends no note when it is blank', async () => {
    const onRate = vi.fn();
    render(<Rated onRate={onRate} />);

    fireEvent.click(notHelpful());
    fireEvent.click(screen.getByRole('button', { name: 'Send rating' }));

    expect(onRate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Choose a reason.');
    expect(
      screen.getByRole('combobox', { name: 'What was wrong?' }).getAttribute('aria-invalid'),
    ).toBe('true');

    pickReason('Too long');

    expect(screen.queryByRole('alert')).toBeNull();

    await press(screen.getByRole('button', { name: 'Send rating' }));

    expect(onRate).toHaveBeenCalledWith({ rating: 'not-helpful', reason: 'too-long', note: null });
  });

  it('cancels without sending and returns focus', () => {
    const onRate = vi.fn();
    render(<Rated initial={{ rating: 'helpful', reason: null, note: null }} onRate={onRate} />);

    fireEvent.click(notHelpful());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRate).not.toHaveBeenCalled();
    expect(screen.queryByRole('form')).toBeNull();
    expect(helpful().getAttribute('aria-pressed')).toBe('true');
    expect(notHelpful().getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(notHelpful());
  });

  it('closes the form when pressed again', () => {
    render(<Rated />);

    fireEvent.click(notHelpful());
    fireEvent.click(notHelpful());

    expect(screen.queryByRole('form')).toBeNull();
  });

  it('reopens a sent not helpful rating with its reason and note, to change them', async () => {
    const onRate = vi.fn();
    render(
      <Rated
        initial={{ rating: 'not-helpful', reason: 'unclear', note: 'Hard to follow.' }}
        onRate={onRate}
      />,
    );

    expect(notHelpful().getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(notHelpful());

    expect(screen.getByRole('combobox', { name: 'What was wrong?' }).textContent).toContain(
      'Unclear',
    );
    expect(screen.getByDisplayValue('Hard to follow.')).toBe(
      screen.getByRole('textbox', { name: 'Note' }),
    );

    pickReason('Inaccurate');
    await press(screen.getByRole('button', { name: 'Send rating' }));

    expect(onRate).toHaveBeenCalledWith({
      rating: 'not-helpful',
      reason: 'inaccurate',
      note: 'Hard to follow.',
    });
  });

  it('switches a not helpful rating to helpful', async () => {
    const onRate = vi.fn();
    render(
      <Rated initial={{ rating: 'not-helpful', reason: 'other', note: null }} onRate={onRate} />,
    );

    await press(helpful());

    expect(onRate).toHaveBeenCalledWith({ rating: 'helpful', reason: null, note: null });
    expect(notHelpful().getAttribute('aria-pressed')).toBe('false');
  });

  it('offers the five reasons', () => {
    render(<Rated />);

    fireEvent.click(notHelpful());
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'What was wrong?' }), { key: 'Enter' });

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Inaccurate',
      'Missed something',
      'Unclear',
      'Too long',
      'Other',
    ]);
  });

  it('turns the buttons off while disabled', () => {
    render(<Rated disabled />);

    expect((helpful() as HTMLButtonElement).disabled).toBe(true);
    expect((notHelpful() as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays busy until the save ends, and closes the form only then', async () => {
    const { promise: saved, resolve: finish } = Promise.withResolvers<undefined>();
    render(<Rated onRate={() => saved} />);

    fireEvent.click(notHelpful());
    pickReason('Unclear');
    const sendButton = screen.getByRole('button', { name: 'Send rating' });
    sendButton.focus();
    await press(sendButton);

    expect(screen.getByRole('form')).toBeDefined();
    // Marked busy but still focusable, so focus stays on Send rather than falling to the page.
    expect(sendButton.getAttribute('aria-disabled')).toBe('true');
    expect(helpful().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(sendButton);
    expect(screen.getByRole('status').textContent).toBe('');

    await act(async () => {
      finish(undefined);
      await saved;
    });

    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Rating sent. Thank you.');
  });

  it('keeps the form and what was entered when the save fails', async () => {
    render(<Rated onRate={() => Promise.reject(new Error('503'))} />);

    fireEvent.click(notHelpful());
    pickReason('Other');
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Wrong year.' },
    });
    await press(screen.getByRole('button', { name: 'Send rating' }));

    expect(screen.getByRole('status').textContent).toBe('Rating not sent. Try again.');
    expect(screen.getByRole('form')).toBeDefined();
    expect(screen.getByDisplayValue('Wrong year.')).toBeDefined();
    expect(notHelpful().getAttribute('aria-pressed')).toBe('true');
    const sendButton = screen.getByRole('button', { name: 'Send rating' });
    expect(sendButton.hasAttribute('aria-disabled')).toBe(false);
    expect(sendButton.matches(':disabled')).toBe(false);
  });

  it('takes a shorter note limit', () => {
    render(<Rated noteMaxLength={500} />);

    fireEvent.click(notHelpful());

    expect(screen.getByRole('textbox', { name: 'Note' }).getAttribute('maxlength')).toBe('500');
  });

  it('ignores presses while a rating is saving', async () => {
    const { promise: saved, resolve: finish } = Promise.withResolvers<undefined>();
    const onRate = vi.fn(() => saved);
    render(<Rated onRate={onRate} />);

    await press(helpful());
    await press(helpful());
    fireEvent.click(notHelpful());

    expect(onRate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('form')).toBeNull();

    await act(async () => {
      finish(undefined);
      await saved;
    });
  });

  it('changes the announcement so a second rating is read out again', async () => {
    render(<Rated />);

    await press(helpful());
    fireEvent.click(notHelpful());
    pickReason('Unclear');
    await press(screen.getByRole('button', { name: 'Send rating' }));

    expect(screen.getByRole('status').textContent).toBe('Rating sent. Thank you.\u00a0');
  });

  it('shows someone else rating as text when read-only', () => {
    const { rerender } = render(
      <FeedbackControl
        readOnly
        ratedBy="Faith Achieng"
        value={{ rating: 'not-helpful', reason: 'too-long', note: null }}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Faith Achieng: not helpful, too long')).toBeDefined();

    rerender(<FeedbackControl readOnly value={{ rating: 'helpful', reason: null, note: null }} />);

    expect(screen.getByText('Rated helpful')).toBeDefined();

    rerender(<FeedbackControl readOnly value={null} />);

    expect(screen.queryByText(/Rated/)).toBeNull();
  });

  it('takes a group name and other copy', () => {
    render(
      <Rated
        messages={{ group: 'Rate the summary', helpful: 'Inasaidia', notHelpful: 'Haisaidii' }}
      />,
    );

    expect(screen.getByRole('group', { name: 'Rate the summary' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Inasaidia' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Haisaidii' })).toBeDefined();
  });
});
