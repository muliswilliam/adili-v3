import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiLabel, type AiLabelDetails, describeAiOutput } from './ai-label';

const SUMMARY: AiLabelDetails = {
  task: 'summarize-declaration',
  provider: 'anthropic',
  model: 'claude-opus-5',
  promptVersion: 3,
  generatedAt: '2026-09-02T11:33:00Z',
};

describe('describeAiOutput', () => {
  it('names the task, provider, model, prompt version and time', () => {
    expect(describeAiOutput(SUMMARY)).toBe(
      'Summary · Anthropic claude-opus-5 · prompt v3 · generated 2 Sep 2026, 14:33',
    );
  });

  it('prints a task or provider it does not know as given', () => {
    expect(describeAiOutput({ ...SUMMARY, task: 'rank-cases', provider: 'self-hosted' })).toBe(
      'rank-cases · self-hosted claude-opus-5 · prompt v3 · generated 2 Sep 2026, 14:33',
    );
  });
});

describe('AiLabel', () => {
  it('always shows text, with the details in its accessible name', () => {
    render(<AiLabel details={SUMMARY} />);

    const label = screen.getByRole('img', {
      name: 'AI-assisted. Summary · Anthropic claude-opus-5 · prompt v3 · generated 2 Sep 2026, 14:33',
    });
    expect(label.textContent).toBe('AI-assisted');
    expect(label.tabIndex).toBe(0);
    expect(label.getAttribute('data-edited')).toBeNull();
  });

  it('shows the details in a tooltip on focus', () => {
    render(<AiLabel details={SUMMARY} />);

    fireEvent.focus(screen.getByRole('img'));

    expect(screen.getByRole('tooltip').textContent).toBe(
      'Summary · Anthropic claude-opus-5 · prompt v3 · generated 2 Sep 2026, 14:33',
    );
  });

  it('takes the panel header text', () => {
    render(<AiLabel details={SUMMARY} text="AI-assisted · generated 24 days ago for version 2" />);

    expect(screen.getByRole('img').textContent).toBe(
      'AI-assisted · generated 24 days ago for version 2',
    );
  });

  it('reads "AI draft, edited" once the reviewer has changed a drafted item', () => {
    render(
      <AiLabel
        details={{ ...SUMMARY, task: 'draft-clarification', promptVersion: 1 }}
        text="AI draft"
        size="sm"
        edited
      />,
    );

    const label = screen.getByRole('img', { name: /^AI draft, edited\. Clarification draft/ });
    expect(label.textContent).toBe('AI draft, edited');
    expect(label.getAttribute('data-edited')).toBe('');
  });

  it('takes other copy', () => {
    render(
      <AiLabel
        details={SUMMARY}
        text="Kwa msaada wa AI"
        describe={({ promptVersion }) => `Toleo ${String(promptVersion)}`}
      />,
    );

    expect(screen.getByRole('img', { name: 'Kwa msaada wa AI. Toleo 3' }).textContent).toBe(
      'Kwa msaada wa AI',
    );
  });
});
