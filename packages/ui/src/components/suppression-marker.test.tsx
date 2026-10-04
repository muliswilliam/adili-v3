import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SuppressionLegend, SuppressionMarker } from './suppression-marker';

function marker(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe('SuppressionMarker', () => {
  it('shows "‹10" for a suppressed figure, and says why in words true of any suppressed cell', () => {
    const { container } = render(<SuppressionMarker />);

    expect(marker(container).dataset.unshown).toBe('suppressed');
    expect(screen.getByText('‹10').getAttribute('aria-hidden')).toBe('true');
    // A complementary cell can count 10 or more officers, so the words never say "fewer than 10".
    expect(screen.getByText('Not shown to protect privacy').className).toContain('sr-only');
    expect(marker(container).title).toBe(
      'Not shown to protect privacy: it counts fewer than 10 officers, or could reveal a figure that does',
    );
  });

  it('follows the release’s threshold', () => {
    const { container } = render(<SuppressionMarker threshold={5} />);

    expect(screen.getByText('‹5')).toBeTruthy();
    expect(marker(container).title).toContain('fewer than 5 officers');
  });

  it('shows "Hidden" for a cell known to be complementary', () => {
    const { container } = render(<SuppressionMarker kind="complementary" />);

    expect(screen.getByText('Hidden').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Hidden to protect a small group').className).toContain('sr-only');
    expect(marker(container).title).toBe(
      'Hidden so a small group cannot be worked out from the totals',
    );
  });

  it('says a Commission did not report', () => {
    const { container } = render(<SuppressionMarker kind="not-reported" />);

    expect(marker(container).dataset.unshown).toBe('not-reported');
    expect(screen.getByText('Not reported').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('The Commission has not reported for this year').className).toContain(
      'sr-only',
    );
  });

  it('says a figure is not collected yet, which is not suppression', () => {
    const { container } = render(<SuppressionMarker kind="not-collected" />);

    expect(marker(container).dataset.unshown).toBe('not-collected');
    expect(screen.getByText('Not collected').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Not collected yet').className).toContain('sr-only');
    expect(marker(container).className).not.toContain('bg-stripes-muted');
  });

  it('takes other wording for one string of one kind, keeping the rest', () => {
    const { container } = render(
      <SuppressionMarker
        kind="suppressed"
        messages={{ suppressed: { text: () => 'Haionyeshwi' } }}
      />,
    );

    expect(screen.getByText('Haionyeshwi')).toBeTruthy();
    expect(screen.getByText('‹10')).toBeTruthy();
    expect(marker(container).title).toContain('Not shown to protect privacy');
  });
});

describe('SuppressionLegend', () => {
  it('explains suppression as a note in words true of every suppressed cell', () => {
    render(<SuppressionLegend />);

    expect(screen.getByRole('note').textContent).toBe(
      'Figures based on fewer than 10 officers, and figures that could reveal them, are not shown to protect privacy.',
    );
  });

  it('counts the cells suppressed, with thousands separators', () => {
    render(<SuppressionLegend cellsSuppressed={1204} />);

    expect(screen.getByRole('note').textContent).toContain('1,204 hidden');
  });

  it('leaves the count out when none is given, and says so when nothing is hidden', () => {
    const { rerender } = render(<SuppressionLegend />);
    expect(screen.getByRole('note').textContent).not.toContain('hidden');

    rerender(<SuppressionLegend cellsSuppressed={0} />);
    expect(screen.getByRole('note').textContent).toContain('0 hidden');
  });

  it('shows a key only for the kinds asked for', () => {
    render(<SuppressionLegend threshold={5} keys={['suppressed', 'not-collected']} />);

    const note = screen.getByRole('note');
    expect(note.textContent).toContain('fewer than 5 officers');
    expect(note.textContent).toContain('‹5');
    expect(note.textContent).toContain('Protects privacy');
    expect(note.textContent).toContain('Not collected yet');
    expect(note.textContent).not.toContain('Hidden');
  });

  it('hides its keys’ chips from screen readers, without a tooltip, as the key words explain them', () => {
    render(<SuppressionLegend keys={['suppressed', 'complementary']} />);

    const chips = screen.getByRole('note').querySelectorAll('[data-unshown]');
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.getAttribute('aria-hidden')).toBe('true');
      expect(chip.getAttribute('title')).toBeNull();
      expect(chip.className).not.toContain('cursor-help');
      expect(chip.querySelector('.sr-only')).toBeNull();
    }
  });

  it('takes other wording for the sentence and one key', () => {
    render(
      <SuppressionLegend
        keys={['suppressed']}
        messages={{
          sentence: () => 'Takwimu ndogo hazionyeshwi.',
          keys: { suppressed: () => 'Faragha' },
        }}
      />,
    );

    expect(screen.getByRole('note').textContent).toContain('Takwimu ndogo hazionyeshwi.');
    expect(screen.getByRole('note').textContent).toContain('Faragha');
  });
});
