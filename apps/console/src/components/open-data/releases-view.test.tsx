// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildOpenDataSnapshot,
  listOpenDataReleases,
} from '../../server/open-data-releases.server';
import {
  mockReportingClient,
  resetReportingMock as resetFormMMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import { setEaccIntakeMockLatency } from '../../server/reporting/eacc-mock.server';
import { resetNcrMock } from '../../server/reporting/ncr-mock.server';
import {
  type ReleasesMockSeed,
  resetReleasesMock,
} from '../../server/reporting/releases-mock.server';
import { ReleasesView } from './releases-view';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={to.replace('$releaseId', params?.releaseId ?? '')} {...props}>
      {children}
    </a>
  ),
}));

const analyst = () =>
  mockReportingClient(['eacc-analyst'], {
    name: 'Brian Otieno',
    subject: 'user-brian-otieno',
    tenant: 'eacc',
  });

async function releasesOf(seed: ReleasesMockSeed) {
  resetReleasesMock(seed);
  return listOpenDataReleases(analyst());
}

type Props = ComponentProps<typeof ReleasesView>;

const LINKS = { publicPage: 'http://portal.test/open-data', verifyBase: null };

function renderView(props: Partial<Props> & Pick<Props, 'result'>) {
  const all: Props = {
    links: LINKS,
    fy: 2026,
    build: (fy, key) => buildOpenDataSnapshot(analyst(), fy, key),
    onBuilt: vi.fn(),
    onUnauthenticated: vi.fn(),
    ...props,
  };
  render(
    <TooltipProvider>
      <ToastProvider>
        <ReleasesView {...all} />
      </ToastProvider>
    </TooltipProvider>,
  );
  return all;
}

beforeEach(() => {
  // FY 2025/2026's reports are in, FY 2026/2027's not due.
  resetFormMMock('2026-10-03');
  setReportingMockLatency(0);
  setEaccIntakeMockLatency(0);
  resetNcrMock('not-built');
});

describe('#350 releases list', () => {
  it('lists each release with its year, kind, version, status and who published it', async () => {
    renderView({ result: await releasesOf('history') });

    const table = screen.getByRole('table', { name: 'Open-data releases' });
    const [first, second, ...rest] = within(table).getAllByRole('row').slice(1);
    if (!first || !second) throw new Error('expected two releases');
    expect(rest).toHaveLength(0);
    expect(first.textContent).toContain('FY 2025/2026');
    expect(first.textContent).toContain('Snapshot');
    expect(first.textContent).toContain('v2');
    expect(first.textContent).toContain('Published');
    expect(first.textContent).toContain('Esther Chebet');
    expect(second.textContent).toContain('Withdrawn');
    expect(second.textContent).toContain('Withdrawn 19 Feb 2026');
    expect(within(first).getByRole('link').getAttribute('href')).toBe(
      '/eacc/open-data/0199c000-0000-7000-8000-000000000002',
    );
    expect(screen.getByRole('link', { name: /Public page/ }).getAttribute('href')).toBe(
      'http://portal.test/open-data',
    );
  });

  it('shows loading rows while the list loads', () => {
    renderView({ result: null });

    expect(
      screen.getByRole('table', { name: 'Open-data releases' }).getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('says there are no releases yet, with Build snapshot', async () => {
    renderView({ result: await releasesOf('none') });

    expect(screen.getByText('No releases yet')).toBeTruthy();
    expect(
      screen.getByText('The annual release publishes when the national report is approved.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Build snapshot/ })).toHaveLength(2);
  });

  it('offers a retry when the list could not be loaded', async () => {
    renderView({ result: await releasesOf('unavailable') });

    expect(screen.getByText('We could not load releases')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('turns away anyone outside EACC', async () => {
    resetReleasesMock('history');
    renderView({ result: await listOpenDataReleases(mockReportingClient(['supervisor'])) });

    expect(screen.getByText('This page is for EACC analysts and supervisors.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Build snapshot/ })).toBeNull();
  });
});

describe('#350 build snapshot', () => {
  it('confirms, shows the build in progress, then opens the preview', async () => {
    const view = renderView({ result: await releasesOf('history') });

    fireEvent.click(screen.getByRole('button', { name: /Build snapshot/ }));
    const dialog = screen.getByRole('dialog', { name: 'Build FY 2026/2027 snapshot' });
    expect(dialog.textContent).toContain(
      'Preview only. Nothing is public until a supervisor publishes.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Build' }));

    expect(await screen.findByText('Building FY 2026/2027 snapshot…')).toBeTruthy();
    await waitFor(() => {
      expect(view.onBuilt).toHaveBeenCalledWith(
        expect.objectContaining({ fy: 2026, status: 'preview', version: 1 }),
      );
    });
  });

  it('S9 stops on a reconciliation failure, naming the totals, and offers a retry', async () => {
    renderView({ result: await releasesOf('reconciliation-failed') });

    fireEvent.click(screen.getByRole('button', { name: /Build snapshot/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Build' }));

    const stopped = await screen.findByText('Snapshot build stopped.');
    const alert = stopped.closest<HTMLElement>('[role="alert"]');
    if (!alert) throw new Error('expected the build failure as an alert');
    expect(alert.textContent).toContain('Snapshot build stopped.');
    expect(alert.textContent).toContain(
      'National totals did not match their source (declarations made in all cycles, declarations made in the final cycle). Nothing was written.',
    );
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Snapshot build stopped.')).toBeNull();
  });
});
