import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type CaseNote, NoteList } from './note-list';

const notes: CaseNote[] = [
  {
    id: '1',
    author: { subject: 'peter', name: 'Peter Mwangi' },
    text: 'Late filing is explained by the HR letter.',
    at: '2026-04-28T08:52:00Z',
  },
  {
    id: '2',
    author: { subject: 'faith', name: 'Faith Achieng' },
    text: 'Asked about the Nyeri plot.\nWaiting for the title deed.',
    at: '2026-09-25T12:05:00Z',
  },
];

describe('NoteList', () => {
  it('lists notes newest first with author, time and text', () => {
    render(<NoteList notes={notes} viewerSubject="faith" />);

    const items = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe(
      'FAFaith Achieng25 Sep 2026, 15:05Asked about the Nyeri plot.\nWaiting for the title deed.',
    );
    expect(items[1]?.textContent).toContain('Peter Mwangi28 Apr 2026, 11:52');
    expect(items[0]?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-25T12:05:00Z');
  });

  it("gives the signed-in officer's notes the brand initials", () => {
    render(<NoteList notes={notes} viewerSubject="faith" />);

    const [mine, theirs] = screen.getAllByRole('listitem');
    expect(mine?.querySelector('[data-me]')).not.toBeNull();
    expect(theirs?.querySelector('[data-me]')).toBeNull();
  });

  it('keeps line breaks in the text', () => {
    render(<NoteList notes={notes} />);

    expect(screen.getByText(/Asked about the Nyeri plot/).className).toContain(
      'whitespace-pre-wrap',
    );
  });

  it('renders nothing when there are no notes', () => {
    const { container } = render(<NoteList notes={[]} />);

    expect(container.firstChild).toBeNull();
  });
});
