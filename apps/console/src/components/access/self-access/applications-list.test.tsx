// @vitest-environment jsdom
import { ACCESS_OFFICER } from '@adili/roles';
import { TooltipProvider } from '@adili/ui';
import { render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAccessClient } from '../../../server/access/mock.server';
import {
  resetSelfAccessMock,
  setSelfAccessMockLatency,
} from '../../../server/access/self-access-mock.server';
import {
  listApplications,
  type SelfAccessPage,
  type SelfAccessResult,
} from '../../../server/self-access.server';
import { SERVICE_UNAVAILABLE } from '../../../server/service-call';
import { ApplicationsList } from './applications-list';

beforeAll(() => {
  setSelfAccessMockLatency(0);
});
afterAll(() => {
  setSelfAccessMockLatency(1);
});
beforeEach(() => {
  resetSelfAccessMock();
});
afterEach(() => {
  vi.useRealTimers();
});

function renderList(result: SelfAccessResult<SelfAccessPage> | null, readOnly = false) {
  render(
    <TooltipProvider>
      <ApplicationsList
        result={result}
        readOnly={readOnly}
        applicationLink={(application) => (
          <a href={`/access/certified-copies/${application.id}`}>
            {application.declarant.fullName}
          </a>
        )}
      />
    </TooltipProvider>,
  );
}

describe('ApplicationsList (slice #302)', () => {
  it('shows each application with who applied, where its copy stands and its deadline', async () => {
    renderList(await listApplications(mockAccessClient([ACCESS_OFFICER]), 'psc', undefined));
    const table = screen.getByRole('table', {
      name: 'Written self-access applications, earliest deadline first',
    });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('rowheader')[0]?.textContent)).toEqual([
      'Alice Nekesa WafulaFile 20118876',
      'Margaret Achieng OdhiamboFile 20150662',
      'Anne Njeri MutuaFile 20114512',
      'Hassan Abdi NoorFile 20128841',
      'Esther Wairimu NjorogeFile 20099314',
      'Rose Chepkemoi KiruiFile 20077719',
    ]);
    const row = (index: number): HTMLElement => {
      const found = rows[index];
      if (!found) throw new Error(`No row ${String(index)}`);
      return found;
    };
    const failed = row(0);
    const ready = row(1);
    const preparing = row(3);
    const dispatched = row(4);
    const collected = row(5);
    expect(within(failed).getByText('Issue failed')).toBeTruthy();
    expect(within(failed).getByText('4 days late')).toBeTruthy();
    expect(within(ready).getByText('Paul Oduor Otieno')).toBeTruthy();
    expect(within(ready).getByText('Representative')).toBeTruthy();
    expect(within(ready).getByText(/^Issued \d/)).toBeTruthy();
    expect(within(preparing).getByText('Preparing')).toBeTruthy();
    expect(within(preparing).getByText('14 days left')).toBeTruthy();
    expect(within(preparing).getByText('Version 1 · Dispatch')).toBeTruthy();
    expect(within(dispatched).getByText(/^Dispatched \d/)).toBeTruthy();
    expect(within(collected).getByText(/^Collected \d/)).toBeTruthy();
  });

  it('counts deadlines in Nairobi days between midnight and 03:00, when UTC is still on yesterday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T01:00:00+03:00'));
    resetSelfAccessMock();
    renderList(await listApplications(mockAccessClient([ACCESS_OFFICER]), 'psc', undefined));
    const table = screen.getByRole('table', {
      name: 'Written self-access applications, earliest deadline first',
    });
    const rowOf = (name: string): HTMLElement => {
      const row = within(table).getByText(name).closest('tr');
      if (!row) throw new Error(`No row for ${name}`);
      return row;
    };
    expect(within(rowOf('Hassan Abdi Noor')).getByText('14 days left')).toBeTruthy();
    expect(within(rowOf('Alice Nekesa Wafula')).getByText('4 days late')).toBeTruthy();
  });

  it('says there are none yet, for the officer and the supervisor', () => {
    renderList({ ok: true, data: { items: [], nextCursor: null } });
    expect(screen.getByText('No applications yet')).toBeTruthy();
    expect(screen.getByText(/record it here/)).toBeTruthy();
  });

  it('shows a load failure and a loading table', () => {
    renderList(SERVICE_UNAVAILABLE);
    expect(screen.getByText('We could not load the applications')).toBeTruthy();
  });

  it('marks the table busy while it loads', () => {
    renderList(null);
    expect(
      screen.getByRole('table', { name: 'Loading applications' }).getAttribute('aria-busy'),
    ).toBe('true');
  });
});
