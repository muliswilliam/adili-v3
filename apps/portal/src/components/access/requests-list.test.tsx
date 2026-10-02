// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { STATUSES } from '../../access/copy';
import { downloadFrom } from '../download';
import { RequestsList } from './requests-list';
import { IDS, NOW, seededRequests, toSummary } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../download', async () => (await import('../declaration/testing-mocks')).downloadMock());

const ACTIONS = { onWithdraw: vi.fn(), onChanged: vi.fn(), download: vi.fn() };
const packageDownload = ACTIONS.download;

afterEach(() => {
  vi.clearAllMocks();
});

async function rows() {
  return (await seededRequests()).map(toSummary);
}

function renderList(list: ReactElement) {
  return render(<ToastProvider>{list}</ToastProvider>);
}

describe('RequestsList (S17)', () => {
  it('shows every status’s badge across the pages', async () => {
    const requests = await rows();
    const seen = new Set<string>();
    for (const page of [1, 2]) {
      const { unmount } = renderList(
        <RequestsList
          requests={requests}
          page={page}
          now={NOW}
          onPage={vi.fn()}
          actions={ACTIONS}
        />,
      );
      for (const item of screen.getAllByRole('listitem')) {
        for (const meta of Object.values(STATUSES)) {
          if (within(item).queryByText(meta.label)) seen.add(meta.label);
        }
      }
      unmount();
    }
    expect([...seen].sort()).toEqual(
      Object.values(STATUSES)
        .map((meta) => meta.label)
        .sort(),
    );
  });

  it('shows each row’s officer, reference, Commission and date, linking to the request', async () => {
    const requests = await rows();
    renderList(
      <RequestsList requests={requests} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    const first = requests[0];
    if (!first) throw new Error('no rows');
    const link = screen.getByRole('link', { name: `Open request ${first.reference}` });
    expect(link.getAttribute('href')).toBe(`/access/requests/${first.id}`);
    expect(within(link).getByText(first.officerName)).toBeTruthy();
    expect(within(link).getByText(first.reference)).toBeTruthy();
    expect(within(link).getByText(/Submitted 2 Oct 2026/)).toBeTruthy();
  });

  it('shows the decision clock only while a request is open', async () => {
    const requests = (await rows()).filter((each) => [IDS.late, IDS.withdrawn].includes(each.id));
    renderList(
      <RequestsList requests={requests} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.getByText(/^\d+ days late$/)).toBeTruthy();
    const withdrawn = requests.find((each) => each.status === 'withdrawn');
    const row = screen.getByRole('link', { name: `Open request ${withdrawn?.reference ?? ''}` });
    expect(within(row).queryByText(/Decision due|left|late/)).toBeNull();
    expect(within(row).getByText(/^Withdrawn \d+ Sep 2026$/)).toBeTruthy();
  });

  it('#261: shows a grant’s download window: days left, soon, today, expired', async () => {
    const requests = await rows();
    const granted = requests.filter(
      (each) => each.downloadExpiresAt !== null || [IDS.failed, IDS.preparing].includes(each.id),
    );
    renderList(
      <RequestsList requests={granted} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    const chip = (key: keyof typeof IDS) => {
      const request = requests.find((each) => each.id === IDS[key]);
      return within(screen.getByRole('link', { name: `Open request ${request?.reference ?? ''}` }));
    };
    expect(chip('granted').getByText('13 days left')).toBeTruthy();
    expect(chip('granted').getByText(/^Download by \d+ Oct 2026, 13 days left$/)).toBeTruthy();
    // What the chip counts down to is written beside it, not only in its title.
    expect(chip('granted').getByText(/^Download by \d+ Oct 2026$/)).toBeTruthy();
    expect(chip('partial').getByText('2 days left').closest('time')?.dataset.state).toBe('soon');
    expect(chip('expiring').getByText('Expires today')).toBeTruthy();
    expect(chip('expired').getByText('Download expired')).toBeTruthy();
    expect(chip('expired').queryByText(/left$/)).toBeNull();
    expect(chip('failed').getByText('Package not issued')).toBeTruthy();
    expect(chip('preparing').queryByText('Package not issued')).toBeNull();
    // A nil letter has the same window as a package.
    expect(chip('nil').getByText('11 days left')).toBeTruthy();
    expect(chip('nilExpired').getByText('Download expired')).toBeTruthy();
  });

  it('sums up a decided row: the grounds and the start of the reasons', async () => {
    const requests = (await rows()).filter(
      (each) => each.id === IDS.denied || each.status === 'under-decision',
    );
    renderList(
      <RequestsList requests={requests} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    const denied = requests.find((each) => each.id === IDS.denied);
    if (!denied?.decision) throw new Error('no denial');
    const row = within(screen.getByRole('link', { name: `Open request ${denied.reference}` }));
    expect(
      row.getByText(/Frivolous, vexatious or scandalous; Does not promote the objectives/),
    ).toBeTruthy();
    expect(row.getByText(denied.decision.reasons)).toBeTruthy();
    const open = requests.find((each) => each.status === 'under-decision');
    const openRow = within(
      screen.getByRole('link', { name: `Open request ${open?.reference ?? ''}` }),
    );
    expect(openRow.queryByText('Grounds:')).toBeNull();
  });

  it('counts the decision clock in Kenyan calendar days, past midnight in Nairobi', async () => {
    const [first] = await rows();
    if (!first) throw new Error('no rows');
    // 00:30 on 2 Oct in Nairobi; due 23:00 on 12 Oct: 10 calendar days, though 10 d 22.5 h away.
    const now = Date.parse('2026-10-01T21:30:00Z');
    const request = {
      ...first,
      status: 'under-decision' as const,
      decisionDeadlineAt: '2026-10-12T20:00:00Z',
      decision: null,
      downloadExpiresAt: null,
    };
    renderList(
      <RequestsList requests={[request]} page={1} now={now} onPage={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.getByText('10 days left').closest('time')?.dataset.state).toBe('soon');
    expect(screen.getByText('Decision due 12 Oct 2026')).toBeTruthy();
  });

  it('shows no download window while the package is prepared or for a denial', async () => {
    const requests = await rows();
    const shown = requests.filter((each) => [IDS.preparing, IDS.denied].includes(each.id));
    renderList(
      <RequestsList requests={shown} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.queryByText(/left$|Download expired|Expires today/)).toBeNull();
  });

  it('pages ten at a time', async () => {
    const requests = await rows();
    const onPage = vi.fn();
    renderList(
      <RequestsList requests={requests} page={1} now={NOW} onPage={onPage} actions={ACTIONS} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('1-10 of 17')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('downloads a granted package from its row while the window is open', async () => {
    const requests = await rows();
    renderList(
      <RequestsList requests={requests} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    const granted = requests.find((each) => each.id === IDS.granted);
    if (!granted?.packageDocumentId) throw new Error('no granted package');
    packageDownload.mockResolvedValue({ status: 'ok', downloadUrl: '/package.pdf' });

    const button = screen.getByRole('button', {
      name: new RegExp(`^Download the package for ${granted.reference}, expires \\d+ Oct 2026$`),
    });
    expect(button.textContent).toBe('Download');
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(packageDownload).toHaveBeenCalledWith(granted.packageDocumentId);
    expect(downloadFrom).toHaveBeenCalledWith('/package.pdf');
    expect(screen.getByText('Download started. Each download is recorded.')).toBeTruthy();
  });

  it('offers no download once the window closed, while prepared, or for a denial; a nil letter is a letter', async () => {
    const requests = await rows();
    const ids = [IDS.expired, IDS.preparing, IDS.failed, IDS.denied, IDS.nil];
    const shown = requests.filter((each) => ids.includes(each.id));
    renderList(
      <RequestsList requests={shown} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    const downloads = screen.getAllByRole('button', { name: /^Download the / });
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.textContent).toBe('Download letter');
  });

  it('reloads the list when the window closed meanwhile', async () => {
    const requests = (await rows()).filter((each) => each.id === IDS.granted);
    renderList(
      <RequestsList requests={requests} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    packageDownload.mockResolvedValue({ status: 'window-closed' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Download the package/ }));
      await Promise.resolve();
    });
    expect(ACTIONS.onChanged).toHaveBeenCalled();
    expect(downloadFrom).not.toHaveBeenCalled();
  });

  it('withdraws an open request from its row, never a decided one', async () => {
    const requests = await rows();
    const open = requests.filter((each) => each.status === 'under-decision');
    const decided = requests.filter((each) => [IDS.granted, IDS.denied].includes(each.id));
    renderList(
      <RequestsList
        requests={[...open, ...decided]}
        page={1}
        now={NOW}
        onPage={vi.fn()}
        actions={ACTIONS}
      />,
    );
    const first = open[0];
    if (!first) throw new Error('no open request');
    expect(screen.getAllByRole('button', { name: /^Withdraw request / })).toHaveLength(open.length);
    for (const each of decided) {
      expect(
        screen.queryByRole('button', { name: `Withdraw request ${each.reference}` }),
      ).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: `Withdraw request ${first.reference}` }));
    expect(ACTIONS.onWithdraw).toHaveBeenCalledWith(first);
  });

  it('invites a first request when there are none', () => {
    renderList(
      <RequestsList requests={[]} page={1} now={NOW} onPage={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.getByText('No requests yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New request' }).getAttribute('href')).toBe(
      '/access/requests/new',
    );
  });
});
