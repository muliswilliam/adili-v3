import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { type Feedback, FeedbackControl, type FeedbackControlProps } from './feedback-control';

// jsdom lacks the pointer capture and scrolling APIs Radix Select calls.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

/** Keeps the rating the way a panel would, after the server accepted it. */
function Rated({
  initial = null,
  onRate = vi.fn(),
  ...props
}: Partial<FeedbackControlProps> & { initial?: Feedback | null }) {
  const [value, setValue] = useState(initial);
  return (
    <FeedbackControl
      value={value}
      onRate={(feedback) => {
        onRate(feedback);
        setValue(feedback);
      }}
      {...props}
    />
  );
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

  it('rates helpful in one press and says so', () => {
    const onRate = vi.fn();
    render(<Rated onRate={onRate} />);

    fireEvent.click(helpful());

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

  it('asks why before sending not helpful, and sends the reason and note', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Send rating' }));

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

  it('requires a reason, and sends no note when it is blank', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Send rating' }));

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

  it('reopens a sent not helpful rating with its reason and note, to change them', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Send rating' }));

    expect(onRate).toHaveBeenCalledWith({
      rating: 'not-helpful',
      reason: 'inaccurate',
      note: 'Hard to follow.',
    });
  });

  it('switches a not helpful rating to helpful', () => {
    const onRate = vi.fn();
    render(
      <Rated initial={{ rating: 'not-helpful', reason: 'other', note: null }} onRate={onRate} />,
    );

    fireEvent.click(helpful());

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
        label="Rate the summary"
        messages={{ helpful: 'Inasaidia', notHelpful: 'Haisaidii' }}
      />,
    );

    expect(screen.getByRole('group', { name: 'Rate the summary' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Inasaidia' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Haisaidii' })).toBeDefined();
  });
});
