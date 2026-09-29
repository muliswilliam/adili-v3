import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfidenceChip, confidenceLevel } from './confidence-chip';

describe('confidenceLevel', () => {
  it('splits scores at 0.85 and 0.6', () => {
    expect(confidenceLevel(1)).toBe('high');
    expect(confidenceLevel(0.85)).toBe('high');
    expect(confidenceLevel(0.84)).toBe('medium');
    expect(confidenceLevel(0.6)).toBe('medium');
    expect(confidenceLevel(0.59)).toBe('low');
    expect(confidenceLevel(0)).toBe('low');
  });
});

describe('ConfidenceChip', () => {
  it('shows every level in text with its own icon', () => {
    const { container } = render(
      <>
        <ConfidenceChip confidence={0.95} />
        <ConfidenceChip confidence={0.7} />
        <ConfidenceChip confidence="low" />
      </>,
    );

    const chips = container.querySelectorAll('[data-level]');
    expect(Array.from(chips, (chip) => chip.textContent)).toEqual([
      'Confidence: High',
      'Confidence: Medium',
      'Confidence: Low',
    ]);
    for (const chip of chips) expect(chip.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Low')).toBeDefined();
  });

  it('takes other copy', () => {
    render(<ConfidenceChip confidence="high" messages={{ high: 'Juu', prefix: 'Uhakika: ' }} />);

    expect(screen.getByText('Juu').textContent).toBe('Uhakika: Juu');
  });
});
