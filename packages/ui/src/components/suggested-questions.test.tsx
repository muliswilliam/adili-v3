import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SuggestedQuestions } from './suggested-questions';

const QUESTIONS = ['Do I declare a car I own with my brother?', 'How do I value my land?'];

describe('SuggestedQuestions', () => {
  it('lists each question as a button under its heading', () => {
    render(<SuggestedQuestions questions={QUESTIONS} onAsk={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Suggested questions' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(QUESTIONS);
  });

  it('asks the question pressed', () => {
    const onAsk = vi.fn();
    render(<SuggestedQuestions questions={QUESTIONS} onAsk={onAsk} />);

    fireEvent.click(screen.getByRole('button', { name: 'How do I value my land?' }));

    expect(onAsk).toHaveBeenCalledWith('How do I value my land?');
  });

  it('turns off while an answer is on its way', () => {
    const onAsk = vi.fn();
    render(<SuggestedQuestions questions={QUESTIONS} onAsk={onAsk} disabled />);

    const button = screen.getByRole('button', { name: 'How do I value my land?' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes another heading', () => {
    render(
      <SuggestedQuestions questions={QUESTIONS} onAsk={vi.fn()} label="Maswali yanayopendekezwa" />,
    );

    expect(screen.getByRole('list', { name: 'Maswali yanayopendekezwa' })).toBeDefined();
  });

  it('renders nothing without questions', () => {
    const { container } = render(<SuggestedQuestions questions={[]} onAsk={vi.fn()} />);

    expect(container.firstElementChild).toBeNull();
  });
});
