// @vitest-environment jsdom
import { mockableClient } from '@adili/api-kit/client';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadOpenDataPage, type OpenDataPage } from '../../server/open-data.server';
import type { ReleaseSelection } from '../../server/open-data.server';
import { mockOpenDataFetch } from '../../server/reporting/mock.server';
import type { paths } from '../../server/reporting/schema';
import { navigate } from '../declaration/testing-mocks';
import { OpenDataView, type OpenDataViewProps } from './open-data-view';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

afterEach(() => {
  navigate.mockClear();
});

/** A page as the BFF loads it from the open-data mock's releases. */
async function page(selection: ReleaseSelection = {}): Promise<OpenDataPage> {
  const client = mockableClient<paths>({
    baseUrl: 'http://reporting.test',
    timeoutMs: 5_000,
    mock: mockOpenDataFetch,
  });
  const loaded = await loadOpenDataPage(client, selection);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  return loaded;
}

function show(props: Partial<OpenDataViewProps> & Pick<OpenDataViewProps, 'page'>) {
  return render(<OpenDataView language="en" onRetry={vi.fn()} {...props} />);
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

describe('the Open data page (spec 09b S11)', () => {
  it('shows the release: year and kind, status, published date and the verification link', async () => {
    const loaded = await page();
    show({ page: loaded });

    expect(screen.getByRole('heading', { level: 1, name: 'Open data' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Release' }).textContent).toContain(
      'FY 2025/26 · Annual',
    );
    expect(screen.getByText('Published', { selector: '[data-status]' })).toBeTruthy();
    expect(screen.getByText('Published 18 Sep 2026')).toBeTruthy();
    const verify = screen.getAllByRole('link', { name: /Verify this release/ });
    expect(verify[0]?.getAttribute('href')).toBe(loaded.release.verifyUrl);
  });

  it('heads the page with the national declaration and compliance rates', async () => {
    const loaded = await page();
    show({ page: loaded });
    const totals = loaded.tables['national-totals'].rows;
    const value = (measure: string) => totals.find((row) => row.measure === measure)?.value ?? 0;

    const tiles = screen.getByRole('region', { name: 'Headline figures' });
    expect(within(tiles).getByText(percent(value('filingRate')))).toBeTruthy();
    expect(within(tiles).getByText('49 of 52 Commissions reported')).toBeTruthy();
    const compliant = value('determinationsCompliant');
    const all =
      compliant + value('determinationsNonCompliant') + value('determinationsFurtherAction');
    expect(within(tiles).getByText(percent(compliant / all))).toBeTruthy();
    expect(within(tiles).getByText('Referrals to EACC')).toBeTruthy();
  });

  it('charts the declaration rate by Commission with a table fallback, gaps listed and not drawn', async () => {
    const loaded = await page();
    show({ page: loaded });

    const chart = screen.getByRole('region', { name: 'By Commission' });
    // The fallback table is always there for assistive tech; eight rows until Show all.
    const table = within(chart).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    fireEvent.click(within(chart).getByRole('button', { name: 'Show all 52' }));
    const rows = within(within(chart).getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(53);
    const judicial = rows.find((row) => row.textContent.includes('Judicial Service Commission'));
    expect(judicial?.textContent).toContain('Not reported');
    // The not-reported and suppressed come last.
    expect(rows.at(-1)?.textContent).toContain('Not reported');
  });

  it('switches the chart to the compliance rate and to lowest first', async () => {
    const loaded = await page();
    show({ page: loaded });
    const chart = screen.getByRole('region', { name: 'By Commission' });

    fireEvent.click(within(chart).getByRole('radio', { name: 'Compliance rate' }));
    fireEvent.click(within(chart).getByRole('button', { name: 'Highest first' }));

    expect(within(chart).getByRole('button', { name: 'Lowest first' })).toBeTruthy();
    const caption = within(chart).getByRole('table').querySelector('caption')?.textContent;
    expect(caption).toBe('Compliance rate by Commission, FY 2025/26');
    const [, first, second] = within(within(chart).getByRole('table')).getAllByRole('row');
    const rate = (row: HTMLElement | undefined) =>
      parseFloat(row?.lastElementChild?.textContent ?? '');
    expect(rate(first)).toBeLessThanOrEqual(rate(second));
  });

  it('shows a chart as its table on screen when asked', async () => {
    const loaded = await page();
    show({ page: loaded });
    const chart = screen.getByRole('region', { name: 'By Commission' });

    fireEvent.click(within(chart).getByRole('button', { name: 'Table' }));

    expect(within(chart).getByRole('button', { name: 'Chart', pressed: true })).toBeTruthy();
    expect(chart.querySelector('[data-chart-table]')?.className).not.toContain('sr-only');
    expect(chart.querySelector('figure')?.className).toContain('[&_[data-chart-plot]]:hidden');
  });

  it('draws the national trend over the published annual years', async () => {
    const loaded = await page();
    show({ page: loaded });

    const trend = screen.getByRole('region', { name: 'National trend' });
    const rows = within(within(trend).getByRole('table')).getAllByRole('row');
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      'Financial year',
      '2024/25',
      '2025/26',
    ]);
  });

  it('says the trend needs a second year on the first year', async () => {
    show({ page: await page({ fy: 2024, kind: 'annual' }) });

    const trend = screen.getByRole('region', { name: 'National trend' });
    expect(within(trend).getByText('The trend appears with a second year')).toBeTruthy();
    expect(within(trend).queryByRole('table')).toBeNull();
  });

  it('lists each table with the suppression legend and markers for figures not shown', async () => {
    const loaded = await page();
    show({ page: loaded });
    const tables = screen.getByRole('region', { name: 'Tables' });

    expect(within(tables).getByRole('note').textContent).toContain(
      'are not shown to protect privacy',
    );
    fireEvent.click(within(tables).getByRole('radio', { name: 'Final' }));
    const lamu = within(tables)
      .getAllByRole('row')
      .find((row) => row.textContent.includes('Lamu County Public Service Board'));
    expect(lamu?.querySelectorAll('[data-unshown="suppressed"]').length).toBe(4);
    expect(lamu?.textContent).toContain('Not shown to protect privacy');
  });

  it('sorts a table by a column, announcing the order', async () => {
    const loaded = await page();
    show({ page: loaded });
    const tables = screen.getByRole('region', { name: 'Tables' });

    fireEvent.click(within(tables).getByRole('button', { name: 'Expected' }));

    const header = within(tables).getByRole('columnheader', { name: /Expected/ });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(within(tables).getByRole('button', { name: 'Expected' }));
    expect(header.getAttribute('aria-sort')).toBe('descending');
    const first = within(tables).getAllByRole('row')[1];
    expect(first?.textContent).toContain('Teachers Service Commission');
  });

  it('marks access requests as not collected, not zero', async () => {
    const loaded = await page();
    show({ page: loaded });
    const tables = screen.getByRole('region', { name: 'Tables' });

    fireEvent.mouseDown(within(tables).getByRole('tab', { name: 'Access requests' }));

    expect(within(tables).getByText(/not collected for open data yet/)).toBeTruthy();
    expect(tables.querySelectorAll('[data-unshown="not-collected"]').length).toBeGreaterThan(0);
  });

  it('offers a CSV per table and the release JSON, with the verification code', async () => {
    const loaded = await page();
    show({ page: loaded });
    const downloads = screen.getByRole('region', { name: 'Downloads' });

    const csv = within(downloads).getByRole('link', {
      name: 'Download filing-by-commission.csv',
    });
    expect(csv.getAttribute('href')).toBe('/api/open-data/2025/annual/1/filing-by-commission.csv');
    expect(csv.hasAttribute('download')).toBe(true);
    expect(within(downloads).getAllByRole('link', { name: /Download .*\.csv/ })).toHaveLength(6);
    expect(
      within(downloads)
        .getByRole('link', { name: /Release \(JSON\)/ })
        .getAttribute('href'),
    ).toBe('/api/open-data/2025/annual/1/release.json');
    expect(within(downloads).getByText(loaded.release.manifestVerificationId)).toBeTruthy();
    expect(
      within(downloads).getByRole('img', { name: 'QR code to verify this release' }),
    ).toBeTruthy();
  });

  it('banners a withdrawn release with its reason and a link to the corrected version (S7)', async () => {
    show({ page: await page({ fy: 2024, kind: 'annual', version: 1 }) });

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('This release was withdrawn on 3 Oct 2025.');
    expect(banner.textContent).toContain('counted twice');
    expect(screen.getByText('Withdrawn', { selector: '[data-status]' })).toBeTruthy();
    expect(within(banner).getByRole('link', { name: 'View version 2' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Version' }).textContent).toContain(
      'Version 1 (withdrawn)',
    );
  });

  it('moves to another release from the selector', async () => {
    show({ page: await page() });

    // Radix Select scrolls the chosen option into view, which jsdom lacks.
    Element.prototype.scrollIntoView = vi.fn();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Release' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'FY 2024/25 · Annual' }));

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ fy: 2024, kind: 'annual' }) as unknown,
      }),
    );
  });

  it('reads in Swahili', async () => {
    show({ page: await page(), language: 'sw' });

    expect(screen.getByRole('heading', { level: 1, name: 'Data huria' })).toBeTruthy();
    expect(screen.getByText('Imechapishwa', { selector: '[data-status]' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Majedwali' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('hazionyeshwi ili kulinda faragha');
    expect(screen.getByRole('radio', { name: 'Kiswahili', checked: true })).toBeTruthy();
  });
});

describe('the Open data page when there is nothing to show', () => {
  it('says no release is published yet', () => {
    show({ page: { status: 'empty' } });

    expect(screen.getByText('No open data yet')).toBeTruthy();
    expect(screen.getByText(/when EACC approves the national report/)).toBeTruthy();
  });

  it('asks to wait when rate-limited, and tries again', () => {
    const onRetry = vi.fn();
    show({ page: { status: 'rate-limited', retryAfterSeconds: 30 }, onRetry });

    expect(screen.getByText('Too many requests')).toBeTruthy();
    expect(screen.getByText('Wait 30 seconds, then try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says open data could not be loaded when the service is down', () => {
    show({ page: { status: 'unavailable' } });

    expect(screen.getByText('We could not load open data')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('points to the latest release when the one asked for does not exist', () => {
    show({ page: { status: 'not-found' } });

    expect(screen.getByText('There is no such release')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the latest release' })).toBeTruthy();
  });
});
