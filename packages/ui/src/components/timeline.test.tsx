import {
  EyeIcon,
  PencilEdit02Icon,
  UserCheck01Icon,
  WorkflowSquare03Icon,
} from '@hugeicons/core-free-icons';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Timeline, type TimelineEntry } from './timeline';

const entries: TimelineEntry[] = [
  {
    id: '1',
    kind: 'claimed',
    at: '2026-09-18T05:47:00Z',
    actor: 'Faith Achieng',
    title: 'Claimed by Faith Achieng',
    icon: UserCheck01Icon,
    tone: 'info',
  },
  {
    id: '2',
    kind: 'note-added',
    at: '2026-09-25T12:05:00Z',
    actor: 'Faith Achieng',
    title: 'Note added',
    icon: PencilEdit02Icon,
  },
  {
    id: '3',
    kind: 'version-processed',
    at: '2026-09-18T05:30:00Z',
    actor: null,
    title: 'Version 1 processed',
    icon: WorkflowSquare03Icon,
    summary: '4 flags raised',
  },
  {
    id: '4',
    kind: 'viewed',
    at: '2026-09-25T12:06:00Z',
    actor: 'Faith Achieng',
    title: 'Viewed 2 times by Faith Achieng',
    icon: EyeIcon,
  },
];

// 30 Sep 2026, noon in Nairobi.
const NOW = Date.parse('2026-09-30T09:00:00Z');

describe('Timeline', () => {
  it('groups entries by Kenyan day under headings, newest day and entry first', () => {
    render(<Timeline entries={entries} now={NOW} />);

    const group = screen.getByRole('group', { name: 'Timeline' });
    expect(
      within(group)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['25 Sep 2026', '18 Sep 2026']);
    const lists = within(group).getAllByRole('list');
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual([
      'Events on 25 Sep 2026',
      'Events on 18 Sep 2026',
    ]);
    expect(
      lists.map((list) =>
        within(list)
          .getAllByRole('listitem')
          .map((item) => item.dataset.kind),
      ),
    ).toEqual([
      ['viewed', 'note-added'],
      ['claimed', 'version-processed'],
    ]);
  });

  it('shows the time as text in a time element, then who acted', () => {
    render(<Timeline entries={entries} now={NOW} />);

    const item = screen.getByText('Claimed by Faith Achieng').closest('li') as HTMLElement;
    const time = item.querySelector('time');
    expect(time?.textContent).toBe('08:47');
    expect(time?.getAttribute('dateTime')).toBe('2026-09-18T05:47:00Z');
    expect(item.textContent).toContain('08:47 · Faith Achieng');
  });

  it('names the system when nobody acted, with the summary under it', () => {
    render(<Timeline entries={entries} now={NOW} />);

    const item = screen.getByText('Version 1 processed').closest('li') as HTMLElement;
    expect(item.textContent).toContain('08:30 · System');
    expect(item.textContent).toContain('4 flags raised');
  });

  it('heads the current day "Today"', () => {
    render(<Timeline entries={entries} now={Date.parse('2026-09-25T15:00:00Z')} />);

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Today',
      '18 Sep 2026',
    ]);
  });

  it('puts an entry after 21:00 UTC on the next Kenyan day', () => {
    render(
      <Timeline
        now={NOW}
        entries={[{ ...entries[0], id: 'late', at: '2026-09-18T21:30:00Z' } as TimelineEntry]}
      />,
    );

    expect(screen.getByRole('heading').textContent).toBe('19 Sep 2026');
    expect(screen.getByText(/00:30/)).toBeTruthy();
  });

  it('tints the icon by tone', () => {
    render(<Timeline entries={entries} now={NOW} />);

    const item = screen.getByText('Claimed by Faith Achieng').closest('li') as HTMLElement;
    expect(item.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('info');
  });

  it('takes a heading level, a label and other wording', () => {
    render(
      <Timeline
        entries={entries}
        now={NOW}
        label="Case timeline"
        headingLevel={4}
        messages={{ system: 'Mfumo', day: (date) => `Matukio ${date}` }}
      />,
    );

    expect(screen.getByRole('group', { name: 'Case timeline' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Matukio 18 Sep 2026' })).toBeTruthy();
    expect(screen.getByText('Version 1 processed').closest('li')?.textContent).toContain(
      '08:30 · Mfumo',
    );
  });
});
