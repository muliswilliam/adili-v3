import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type Note, NoteList } from './note-list';

const notes: Note[] = [
  {
    id: '1',
    author: 'Peter Mwangi',
    at: '2026-04-28T08:52:00Z',
    text: 'Late filing is explained by the HR letter.',
  },
  {
    id: '2',
    author: 'Faith Achieng',
    current: true,
    at: '2026-09-25T12:05:00Z',
    text: 'Checked the KRA figure.\nSpouse income still open.',
  },
];

describe('NoteList', () => {
  it('lists notes newest first with author and Kenyan time', () => {
    render(<NoteList notes={notes} />);

    const items = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('.font-semibold')?.textContent)).toEqual([
      'Faith Achieng',
      'Peter Mwangi',
    ]);
    const time = items[1]?.querySelector('time');
    expect(time?.textContent).toBe('28 Apr 2026, 11:52');
    expect(time?.getAttribute('dateTime')).toBe('2026-04-28T08:52:00Z');
  });

  it('keeps line breaks in the text', () => {
    render(<NoteList notes={notes} />);

    const text = screen.getByText(/Checked the KRA figure/);
    expect(text.textContent).toBe('Checked the KRA figure.\nSpouse income still open.');
    expect(text.className).toContain('whitespace-pre-wrap');
  });

  it("gives the signed-in user's notes the brand avatar", () => {
    render(<NoteList notes={notes} />);

    const mine = screen.getByText('Faith Achieng').closest('li') as HTMLElement;
    expect(mine.querySelector('[data-current]')?.textContent).toBe('FA');
  });

  it('shows the empty content without notes', () => {
    render(<NoteList notes={[]} empty={<p>No notes yet</p>} />);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('No notes yet')).toBeTruthy();
  });

  it('renders nothing without notes or empty content', () => {
    const { container } = render(<NoteList notes={[]} />);

    expect(container.firstChild).toBeNull();
  });
});
