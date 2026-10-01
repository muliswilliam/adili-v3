// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { STATUSES } from '../../access/copy';
import { RequestsList } from './requests-list';
import { IDS, NOW, seededRequests, toSummary } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

async function rows() {
  return (await seededRequests()).map(toSummary);
}

describe('RequestsList (S17)', () => {
  it('shows every status’s badge across the pages', async () => {
    const requests = await rows();
    const seen = new Set<string>();
    for (const page of [1, 2]) {
      const { unmount } = render(
        <RequestsList requests={requests} page={page} now={NOW} onPage={vi.fn()} />,
      );
      for (const item of screen.getAllByRole('listitem')) {
        for (const meta of Object.values(STATUSES)) {
          if (within(item).queryByText(meta.label.en)) seen.add(meta.label.en);
        }
      }
      unmount();
    }
    expect([...seen].sort()).toEqual(
      Object.values(STATUSES)
        .map((meta) => meta.label.en)
        .sort(),
    );
  });

  it('shows each row’s officer, reference, Commission and date, linking to the request', async () => {
    const requests = await rows();
    render(<RequestsList requests={requests} page={1} now={NOW} onPage={vi.fn()} />);
    const first = requests[0];
    if (!first) throw new Error('no rows');
    const link = screen.getByRole('link', { name: `Open request ${first.reference}` });
    expect(link.getAttribute('href')).toBe(`/access/requests/${first.id}`);
    expect(within(link).getByText(first.officerName)).toBeTruthy();
    expect(within(link).getByText(first.reference)).toBeTruthy();
    expect(within(link).getByText(/Submitted 2 Oct 2026/)).toBeTruthy();
  });

  it('shows the decision clock only while a request is open', async () => {
    const requests = await rows();
    render(<RequestsList requests={requests} page={1} now={NOW} onPage={vi.fn()} />);
    expect(screen.getByText(/^\d+ days late$/)).toBeTruthy();
    const withdrawn = requests.find((each) => each.status === 'withdrawn');
    const row = screen.getByRole('link', { name: `Open request ${withdrawn?.reference ?? ''}` });
    expect(within(row).queryByText(/Decision due|left|late/)).toBeNull();
    expect(within(row).getByText(/^Withdrawn \d+ Sep 2026$/)).toBeTruthy();
  });

  it('#261: shows a grant’s download window: days left, soon, today, expired', async () => {
    const requests = await rows();
    const granted = requests.filter((each) => each.downloadExpiresAt !== null);
    render(<RequestsList requests={granted} page={1} now={NOW} onPage={vi.fn()} />);
    const chip = (key: keyof typeof IDS) => {
      const request = requests.find((each) => each.id === IDS[key]);
      return within(screen.getByRole('link', { name: `Open request ${request?.reference ?? ''}` }));
    };
    expect(chip('granted').getByText('13 days left')).toBeTruthy();
    expect(chip('granted').getByText(/^Download by \d+ Oct 2026, 13 days left$/)).toBeTruthy();
    expect(chip('partial').getByText('2 days left').closest('time')?.dataset.state).toBe('soon');
    expect(chip('expiring').getByText('Expires today')).toBeTruthy();
    expect(chip('expired').getByText('Download expired')).toBeTruthy();
    expect(chip('expired').queryByText(/left$/)).toBeNull();
  });

  it('shows no download window while the package is prepared or for a denial', async () => {
    const requests = await rows();
    const shown = requests.filter((each) => [IDS.preparing, IDS.denied].includes(each.id));
    render(<RequestsList requests={shown} page={1} now={NOW} onPage={vi.fn()} />);
    expect(screen.queryByText(/left$|Download expired|Expires today/)).toBeNull();
  });

  it('pages ten at a time', async () => {
    const requests = await rows();
    const onPage = vi.fn();
    render(<RequestsList requests={requests} page={1} now={NOW} onPage={onPage} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('1-10 of 14')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('invites a first request when there are none', () => {
    render(<RequestsList requests={[]} page={1} now={NOW} onPage={vi.fn()} />);
    expect(screen.getByText('No requests yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New request' }).getAttribute('href')).toBe(
      '/access/requests/new',
    );
  });
});
