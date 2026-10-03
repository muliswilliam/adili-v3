import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SuppressionLegend, SuppressionMarker } from './suppression-marker';

describe('SuppressionMarker', () => {
  it('shows "‹10" for a figure over fewer than 10 officers, and says so in words', () => {
    const { container } = render(<SuppressionMarker />);

    const marker = container.firstElementChild as HTMLElement;
    expect(marker.textContent).toContain('‹10');
    expect(screen.getByText('‹10').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Fewer than 10 officers, not shown').className).toContain('sr-only');
    expect(marker.title).toBe('Fewer than 10 officers');
    expect(marker.dataset.suppression).toBe('under-threshold');
  });

  it('follows the release’s threshold', () => {
    render(<SuppressionMarker threshold={5} />);

    expect(screen.getByText('‹5')).toBeTruthy();
    expect(screen.getByText('Fewer than 5 officers, not shown')).toBeTruthy();
  });

  it('shows "Hidden" for a figure hidden so a small group cannot be worked out from a total', () => {
    const { container } = render(<SuppressionMarker kind="complementary" />);

    const marker = container.firstElementChild as HTMLElement;
    expect(screen.getByText('Hidden').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Hidden to protect a small group').className).toContain('sr-only');
    expect(marker.title).toBe('Hidden so a small group cannot be worked out from the totals');
  });

  it('says a Commission did not report, read as it is shown', () => {
    const { container } = render(<SuppressionMarker kind="not-reported" />);

    const marker = container.firstElementChild as HTMLElement;
    expect(marker.textContent).toBe('Not reported');
    expect(marker.querySelector('[aria-hidden]')).toBeNull();
    expect(marker.title).toBe('');
  });

  it('takes other wording', () => {
    render(
      <SuppressionMarker
        kind="complementary"
        messages={{ complementary: 'Imefichwa', complementaryText: 'Imefichwa ili kulinda' }}
      />,
    );

    expect(screen.getByText('Imefichwa')).toBeTruthy();
    expect(screen.getByText('Imefichwa ili kulinda')).toBeTruthy();
  });
});

describe('SuppressionLegend', () => {
  it('explains the markers as a note, with a key for each', () => {
    render(<SuppressionLegend />);

    const note = screen.getByRole('note');
    expect(note.textContent).toContain(
      'Cells based on fewer than 10 officers are not shown to protect privacy.',
    );
    expect(note.textContent).toContain('‹10');
    expect(note.textContent).toContain('Under 10');
    expect(note.textContent).toContain('Protects a total');
  });

  it('counts the cells hidden, with thousands separators', () => {
    render(<SuppressionLegend hiddenCount={1204} />);

    expect(screen.getByRole('note').textContent).toContain('1,204 hidden');
  });

  it('leaves the count out when none is given, and says so when nothing is hidden', () => {
    const { rerender } = render(<SuppressionLegend />);
    expect(screen.getByRole('note').textContent).not.toContain('hidden');

    rerender(<SuppressionLegend hiddenCount={0} />);
    expect(screen.getByRole('note').textContent).toContain('0 hidden');
  });

  it('keeps only the sentence when compact, for a table toolbar', () => {
    render(<SuppressionLegend compact threshold={5} />);

    const note = screen.getByRole('note');
    expect(note.textContent).toContain('fewer than 5 officers');
    expect(note.textContent).not.toContain('Under 5');
  });

  it('hides its keys’ markers from screen readers, which read the key words', () => {
    render(<SuppressionLegend />);

    const note = screen.getByRole('note');
    expect(note.querySelector('[data-suppression]')?.getAttribute('aria-hidden')).toBe('true');
  });
});
