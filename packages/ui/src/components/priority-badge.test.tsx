import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PRIORITY_BADGE_MESSAGES, PriorityBadge } from './priority-badge';

const indicator = 'Indicator for ordering only. Not a finding.';

describe('PriorityBadge', () => {
  it('carries the band as text with the indicator note in its accessible name', () => {
    render(<PriorityBadge priority="high" />);

    const badge = screen.getByRole('img', { name: `High priority. ${indicator}` });
    expect(badge.textContent).toBe('High');
    expect(badge.dataset.priority).toBe('high');
    expect(badge.className).toContain('text-destructive');
  });

  it('tints medium amber and low grey, each with its word', () => {
    render(
      <>
        <PriorityBadge priority="medium" />
        <PriorityBadge priority="low" />
      </>,
    );

    expect(screen.getByText('Medium').className).toContain('text-warning');
    expect(screen.getByText('Low').className).toContain('text-secondary-foreground');
  });

  it('lights one bar per band, never colour alone', () => {
    render(
      <>
        <PriorityBadge priority="high" />
        <PriorityBadge priority="medium" />
        <PriorityBadge priority="low" />
      </>,
    );

    const lit = (word: string) =>
      [...screen.getByText(word).querySelectorAll('rect')].filter(
        (bar) => bar.getAttribute('opacity') === '1',
      ).length;
    expect([lit('High'), lit('Medium'), lit('Low')]).toEqual([3, 2, 1]);
    expect(screen.getByText('High').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the indicator note in a tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<PriorityBadge priority="medium" />);

    await user.tab();

    expect(document.activeElement?.textContent).toBe('Medium');
    expect((await screen.findByRole('tooltip')).textContent).toBe(indicator);
  });

  it('without the tooltip is not a tab stop but keeps the note in its name', () => {
    render(<PriorityBadge priority="low" tooltip={false} />);

    const badge = screen.getByRole('img', { name: `Low priority. ${indicator}` });
    expect(badge.hasAttribute('tabindex')).toBe(false);
  });

  it('takes other wording', () => {
    render(
      <PriorityBadge
        priority="high"
        messages={{
          bands: { high: 'Juu' },
          label: (band) => `Kipaumbele ${band}`,
          indicator: 'Kiashiria tu.',
        }}
      />,
    );

    expect(screen.getByRole('img', { name: 'Kipaumbele Juu. Kiashiria tu.' }).textContent).toBe(
      'Juu',
    );
    expect(PRIORITY_BADGE_MESSAGES.bands.high).toBe('High');
  });
});
