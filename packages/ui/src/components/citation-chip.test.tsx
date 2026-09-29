import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type Citation, CitationList } from './citation-chip';

const CITATIONS: Citation[] = [
  {
    id: 'act-31-4',
    source: 'act',
    citation: 'Act s.31(4)',
    title: 'Declaring for a spouse',
    snippet: 'A public officer shall declare the income, assets and liabilities of a spouse.',
  },
  {
    id: 'help-joint',
    source: 'help',
    citation: 'Help: Joint assets',
    title: 'Joint assets',
    snippet: 'If you own an asset with someone else, declare it once at its whole value.',
  },
];

describe('CitationList', () => {
  it('shows each citation as a button named by its text', () => {
    render(<CitationList citations={CITATIONS} />);

    const act = screen.getByRole('button', { name: 'Act s.31(4)' });
    expect(act.getAttribute('aria-expanded')).toBe('false');
    expect(act.getAttribute('data-source')).toBe('act');
    expect(screen.getByRole('button', { name: 'Help: Joint assets' })).toBeDefined();
  });

  it('expands one passage at a time under the chips', () => {
    render(<CitationList citations={CITATIONS} />);
    const act = screen.getByRole('button', { name: 'Act s.31(4)' });
    const help = screen.getByRole('button', { name: 'Help: Joint assets' });

    fireEvent.click(act);

    expect(act.getAttribute('aria-expanded')).toBe('true');
    const passage = document.getElementById(act.getAttribute('aria-controls') ?? '');
    expect(passage?.textContent).toContain('Declaring for a spouse');
    expect(passage?.textContent).toContain('Conflict of Interest Act, 2025');
    expect(passage?.textContent).toContain('shall declare the income');

    fireEvent.click(help);

    expect(act.getAttribute('aria-expanded')).toBe('false');
    expect(help.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('Declaring for a spouse')).toBeNull();

    fireEvent.click(help);

    expect(help.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Joint assets')).toBeNull();
  });

  it('links an open passage to its help page', () => {
    const onReadPassage = vi.fn();
    render(<CitationList citations={CITATIONS} onReadPassage={onReadPassage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Help: Joint assets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read in help' }));

    expect(onReadPassage).toHaveBeenCalledWith(CITATIONS[1]);
  });

  it('has no link without somewhere to read', () => {
    render(<CitationList citations={CITATIONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Act s.31(4)' }));

    expect(screen.queryByRole('button', { name: 'Read in help' })).toBeNull();
  });

  it('renders nothing without citations', () => {
    const { container } = render(<CitationList citations={[]} />);

    expect(container.firstElementChild).toBeNull();
  });
});
