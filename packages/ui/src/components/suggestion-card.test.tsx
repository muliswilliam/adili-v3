import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  emptyFieldDiff,
  SuggestionCard,
  type SuggestionCardProps,
  type SuggestionField,
} from './suggestion-card';

const AT = '2026-09-26T07:32:00Z';
const TITLE = 'KCA 123A · Toyota Probox 2016';
const REGISTRATION: SuggestionField = {
  key: 'registration',
  label: 'Registration',
  value: 'KCA 123A',
};
const FIELDS: SuggestionField[] = [
  REGISTRATION,
  { key: 'makeModel', label: 'Make and model', value: 'Toyota Probox' },
];

function renderCard(props: Partial<SuggestionCardProps> = {}) {
  const handlers = {
    onAdd: vi.fn(),
    onEditAndAdd: vi.fn(),
    onApply: vi.fn(),
    onDismiss: vi.fn(),
    onView: vi.fn(),
  };
  render(<SuggestionCard title={TITLE} source="ntsa" at={AT} {...handlers} {...props} />);
  const card = screen.getByRole('article', { name: TITLE });
  return { card: within(card), element: card, ...handlers };
}

function buttonNames(card: HTMLElement) {
  return within(card)
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
}

describe('emptyFieldDiff', () => {
  it('keeps suggested values whose field is empty in the item', () => {
    expect(
      emptyFieldDiff(
        [
          ...FIELDS,
          { key: 'year', label: 'Year', value: '2016' },
          { key: 'colour', label: 'Colour', value: ' ' },
        ],
        { registration: 'KCA 123A', makeModel: '  ', year: null, colour: '' },
      ).map((field) => field.key),
    ).toEqual(['makeModel', 'year']);
  });
});

describe('SuggestionCard', () => {
  it('shows a new suggestion with its source, preview and three actions named after it', () => {
    const { card, element, onAdd, onEditAndAdd, onDismiss } = renderCard({
      fields: FIELDS,
      description: 'Motor vehicle · add the value yourself',
    });

    expect(card.getByRole('heading', { level: 3, name: TITLE })).toBeDefined();
    expect(card.getByText('From NTSA, 26 Sep 2026')).toBeDefined();
    expect(card.getByText('Motor vehicle · add the value yourself')).toBeDefined();
    expect(card.getByText('Registration').nextElementSibling?.textContent).toBe('KCA 123A');
    expect(buttonNames(element)).toEqual([
      `Add: ${TITLE}`,
      `Edit and add: ${TITLE}`,
      `Dismiss: ${TITLE}`,
    ]);

    fireEvent.click(card.getByRole('button', { name: `Add: ${TITLE}` }));
    fireEvent.click(card.getByRole('button', { name: `Edit and add: ${TITLE}` }));
    fireEvent.click(card.getByRole('button', { name: `Dismiss: ${TITLE}` }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onEditAndAdd).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('leads with applying to a match, listing the empty fields it fills', () => {
    const { card, element, onApply } = renderCard({
      fields: FIELDS,
      match: { title: 'Toyota Probox', fills: [REGISTRATION] },
    });

    expect(card.getByText(/Matches/).textContent).toBe(
      'Matches "Toyota Probox". Fills: Registration KCA 123A',
    );
    expect(buttonNames(element)).toEqual([
      `Apply to this item: ${TITLE}`,
      `Add: ${TITLE}`,
      `Edit and add: ${TITLE}`,
      `Dismiss: ${TITLE}`,
    ]);
    // The preview is replaced by the fields it fills.
    expect(card.queryByText('Make and model')).toBeNull();

    fireEvent.click(card.getByRole('button', { name: `Apply to this item: ${TITLE}` }));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('still leads with Apply when a match has nothing to fill, as applying confirms the item', () => {
    const { card, element, onApply } = renderCard({ match: { title: 'Toyota Probox', fills: [] } });

    expect(card.getByText(/Matches/).textContent).toBe(
      `Matches "Toyota Probox". Nothing to fill. Applying records NTSA as this item's source.`,
    );
    expect(buttonNames(element)).toEqual([
      `Apply to this item: ${TITLE}`,
      `Add: ${TITLE}`,
      `Edit and add: ${TITLE}`,
      `Dismiss: ${TITLE}`,
    ]);
    fireEvent.click(card.getByRole('button', { name: `Apply to this item: ${TITLE}` }));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('collapses to "Added" with a link to the item once accepted', () => {
    const { card, element, onView } = renderCard({ status: 'accepted' });

    expect(card.getByText('Added')).toBeDefined();
    expect(buttonNames(element)).toEqual([`View: ${TITLE}`]);
    fireEvent.click(card.getByRole('button', { name: `View: ${TITLE}` }));
    expect(onView).toHaveBeenCalledOnce();
  });

  it('reads "Applied" once a match is accepted', () => {
    const { card } = renderCard({
      status: 'accepted',
      match: { title: 'Toyota Probox', fills: [REGISTRATION] },
    });

    expect(card.getByText('Applied')).toBeDefined();
  });

  it('shows a dismissed suggestion with no actions', () => {
    const { card, element } = renderCard({ status: 'dismissed' });

    expect(element.dataset.status).toBe('dismissed');
    expect(card.getByText('Dismissed')).toBeDefined();
    expect(card.getByText('From NTSA, 26 Sep 2026')).toBeDefined();
    expect(card.queryAllByRole('button')).toHaveLength(0);
  });

  it('replaces the actions with a status while saving or refreshing', () => {
    const { card, element } = renderCard({ busy: 'refreshing' });

    expect(element.getAttribute('aria-busy')).toBe('true');
    expect(card.getByRole('status').textContent).toBe('Your statement changed. Refreshing…');
    expect(card.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows "Saving…" while accepting', () => {
    const { card } = renderCard({ busy: 'saving' });

    expect(card.getByRole('status').textContent).toBe('Saving…');
  });

  it('offers only the actions it has handlers for, disabled when asked', () => {
    render(<SuggestionCard title={TITLE} source="brs" at={AT} onDismiss={vi.fn()} disabled />);

    const buttons = screen.getAllByRole<HTMLButtonElement>('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      `Dismiss: ${TITLE}`,
    ]);
    expect(buttons[0]?.disabled).toBe(true);
  });

  it('takes other copy and heading level', () => {
    const { card } = renderCard({
      headingLevel: 4,
      source: 'document',
      messages: {
        source: (source, date) => `Kutoka ${source}, ${date}`,
        add: 'Ongeza',
        actionLabel: (action, title) => `${action} ${title}`,
      },
    });

    expect(card.getByRole('heading', { level: 4, name: TITLE })).toBeDefined();
    expect(card.getByText('Kutoka Document, 26 Sep 2026')).toBeDefined();
    expect(card.getByRole('button', { name: `Ongeza ${TITLE}` }).textContent).toBe('Ongeza');
  });
});
