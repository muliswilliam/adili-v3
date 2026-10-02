import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Timeline, type TimelineEvent } from './timeline';

// 25 Sep 2026, 18:00 in Nairobi.
const NOW = Date.parse('2026-09-25T15:00:00Z');

const events: TimelineEvent[] = [
  {
    id: '1',
    at: '2026-09-02T11:30:00Z',
    title: 'Version 2 processed',
    actor: null,
    tone: 'warning',
  },
  {
    id: '2',
    at: '2026-09-25T12:05:00Z',
    title: 'Note added',
    actor: 'Faith Achieng',
  },
  {
    id: '3',
    at: '2026-09-02T11:31:00Z',
    title: 'Registries checked',
    actor: null,
    detail: '5 mismatched, 1 unavailable',
  },
  {
    id: '4',
    at: '2026-09-25T05:47:00Z',
    title: 'Indicator reviewed',
    actor: 'Faith Achieng',
    icon: CheckmarkCircle02Icon,
    tone: 'success',
  },
];

describe('Timeline', () => {
  it('lists events newest first, a list per day under its heading', () => {
    render(<Timeline events={events} now={NOW} />);

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Today',
      '2 Sep 2026',
    ]);
    const today = screen.getByRole('list', { name: 'Events on 25 Sep 2026' });
    expect(
      within(today)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Note added15:05 · Faith Achieng', 'Indicator reviewed08:47 · Faith Achieng']);
    const earlier = screen.getByRole('list', { name: 'Events on 2 Sep 2026' });
    expect(
      within(earlier)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Registries checked14:31 · System5 mismatched, 1 unavailable',
      'Version 2 processed14:30 · System',
    ]);
  });

  it('groups by the day in Kenya, not in UTC', () => {
    render(
      <Timeline
        now={NOW}
        events={[
          { id: 'a', at: '2026-09-01T21:30:00Z', title: 'Late at night', actor: null },
          { id: 'b', at: '2026-09-02T05:00:00Z', title: 'Next morning', actor: null },
        ]}
      />,
    );

    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['2 Sep 2026']);
  });

  it('gives each event a machine-readable time and its tint', () => {
    const { container } = render(<Timeline events={events} now={NOW} />);

    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-25T12:05:00Z');
    expect(
      [...container.querySelectorAll('[data-tone]')].map((el) => el.getAttribute('data-tone')),
    ).toEqual(['default', 'success', 'default', 'warning']);
  });

  it('takes the heading level and other copy', () => {
    render(
      <Timeline
        events={events.slice(0, 1)}
        now={NOW}
        headingLevel={4}
        messages={{ system: 'Mfumo', dayLabel: (day) => `Matukio ${day}` }}
      />,
    );

    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('2 Sep 2026');
    expect(screen.getByRole('list', { name: 'Matukio 2 Sep 2026' }).textContent).toContain('Mfumo');
  });

  it('renders no days for no events', () => {
    render(<Timeline events={[]} now={NOW} />);

    expect(screen.queryByRole('list')).toBeNull();
  });
});
