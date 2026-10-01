import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  REGISTER_KINDS,
  type RegisterEntry,
  registerKindMeta,
  RegisterList,
  RegisterTimeline,
} from './register-timeline';

const entries: RegisterEntry[] = [
  {
    id: '1',
    kind: 'received',
    at: '2026-08-28T13:02:00Z',
    actor: 'Mercy Wanjiku Kamau (applicant)',
    reference: 'ARQ-PSC-2026-0000001-7',
    summary: 'Form K submitted. Acknowledgement sent.',
  },
  {
    id: '2',
    kind: 'decided',
    at: '2026-09-24T07:30:00Z',
    actor: 'Lucy Wambui',
    reference: 'ARQ-PSC-2026-0000001-7',
  },
  {
    id: '3',
    kind: 'notified',
    at: '2026-09-02T06:15:00Z',
    actor: null,
    reference: 'ARQ-PSC-2026-0000001-7',
  },
];

describe('RegisterTimeline', () => {
  it('is a labelled ordered list, newest first', () => {
    render(<RegisterTimeline entries={entries} />);

    const list = screen.getByRole('list', { name: 'Access register' });
    expect(list.tagName).toBe('OL');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.dataset.kind),
    ).toEqual(['decided', 'notified', 'received']);
  });

  it('renders every kind with its icon and copy', () => {
    render(
      <RegisterTimeline
        entries={REGISTER_KINDS.map((kind, index) => ({
          id: kind,
          kind,
          at: `2026-09-${String(10 + index)}T09:00:00Z`,
        }))}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(REGISTER_KINDS.length);
    for (const item of items) {
      const kind = item.dataset.kind as (typeof REGISTER_KINDS)[number];
      expect(within(item).getByText(registerKindMeta[kind].label)).toBeDefined();
      const icon = item.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(item.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe(
        registerKindMeta[kind].tone,
      );
    }
    expect(registerKindMeta['cannot-identify']).toMatchObject({
      label: 'Declarant could not be identified',
      tone: 'destructive',
    });
  });

  it('shows the actor and the time in Kenyan time with a machine-readable datetime', () => {
    render(<RegisterTimeline entries={entries} />);

    const received = screen.getAllByRole('listitem')[2];
    const time = received?.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-08-28T13:02:00Z');
    expect(time?.textContent).toBe('28 Aug 2026, 16:02');
    expect(received?.textContent).toContain('Mercy Wanjiku Kamau (applicant) · 28 Aug 2026, 16:02');
    expect(received?.textContent).toContain('Form K submitted. Acknowledgement sent.');
    // No actor: the time stands alone.
    expect(screen.getAllByRole('listitem')[1]?.textContent).toBe(
      'Declarant notified2 Sep 2026, 09:15',
    );
  });

  it('takes the audience’s own title and tone for an entry', () => {
    render(
      <RegisterTimeline
        label="Who accessed my declaration"
        entries={[
          {
            id: '1',
            kind: 'notified',
            at: '2026-09-02T06:15:00Z',
            title: 'Mercy Wanjiku Kamau asked to see your declaration',
            tone: 'brand',
          },
        ]}
      />,
    );

    const item = within(
      screen.getByRole('list', { name: 'Who accessed my declaration' }),
    ).getByRole('listitem');
    expect(
      within(item).getByText('Mercy Wanjiku Kamau asked to see your declaration'),
    ).toBeDefined();
    expect(within(item).queryByText('Declarant notified')).toBeNull();
    expect(item.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('brand');
  });

  it('reads and tints a decision by its outcome', () => {
    render(
      <RegisterTimeline
        entries={[
          { id: 'g', kind: 'decided', at: '2026-09-03T06:00:00Z', outcome: 'grant' },
          { id: 'p', kind: 'decided', at: '2026-09-02T06:00:00Z', outcome: 'partial-grant' },
          { id: 'd', kind: 'decided', at: '2026-09-01T06:00:00Z', outcome: 'deny' },
          { id: 'x', kind: 'decided', at: '2026-08-31T06:00:00Z' },
        ]}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(
      items.map((item) => [
        item.querySelector('.font-medium')?.textContent,
        item.querySelector('[data-tone]')?.getAttribute('data-tone'),
      ]),
    ).toEqual([
      ['Access granted', 'success'],
      ['Access partially granted', 'warning'],
      ['Access denied', 'destructive'],
      ['Decision recorded', 'default'],
    ]);
  });

  describe('RegisterList', () => {
    it('groups entries by month under headings, newest first', () => {
      render(<RegisterList entries={entries} />);

      const group = screen.getByRole('group', { name: 'Access register' });
      const headings = within(group).getAllByRole('heading', { level: 3 });
      expect(headings.map((heading) => heading.textContent)).toEqual([
        'September 2026',
        'August 2026',
      ]);
      const september = screen.getByRole('list', { name: 'September 2026' });
      expect(
        within(september)
          .getAllByRole('listitem')
          .map((item) => item.dataset.kind),
      ).toEqual(['decided', 'notified']);
      expect(
        within(screen.getByRole('list', { name: 'August 2026' })).getAllByRole('listitem'),
      ).toHaveLength(1);
    });

    it('takes the heading level of the page around it', () => {
      render(<RegisterList entries={entries} headingLevel={2} />);

      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    });

    it('shows the reference and the date, with the full time for screen readers', () => {
      render(<RegisterList entries={entries} />);

      const received = within(screen.getByRole('list', { name: 'August 2026' })).getByRole(
        'listitem',
      );
      expect(within(received).getByText('ARQ-PSC-2026-0000001-7')).toBeDefined();
      const time = received.querySelector('time');
      expect(time?.getAttribute('datetime')).toBe('2026-08-28T13:02:00Z');
      expect(within(time as HTMLElement).getByText('28 Aug 2026, 16:02').className).toContain(
        'sr-only',
      );
      expect(
        within(time as HTMLElement)
          .getByText('28 Aug 2026')
          .getAttribute('aria-hidden'),
      ).toBe('true');
    });

    it('makes each row a button that opens the entry when asked to', async () => {
      const onSelect = vi.fn();
      render(<RegisterList entries={entries} onSelect={onSelect} />);

      const september = screen.getByRole('list', { name: 'September 2026' });
      await userEvent.click(within(september).getByRole('button', { name: /Decision recorded/ }));

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'decided' }));
      expect(screen.getAllByRole('button')).toHaveLength(entries.length);
    });

    it('has no buttons without onSelect', () => {
      render(<RegisterList entries={entries} />);

      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
  });
});
