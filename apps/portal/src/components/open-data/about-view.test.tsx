// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AboutView } from './about-view';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

const API = 'https://api.adili.go.ke/open-data/v1';

describe('About this data (spec 09b FE-4)', () => {
  it('explains the privacy rule with the suppression legend', () => {
    render(<AboutView language="en" apiBase={API} />);

    const privacy = screen.getByRole('region', { name: 'Privacy' });
    expect(within(privacy).getByRole('note').textContent).toContain('not shown to protect privacy');
    expect(privacy.textContent).toContain('No names and no individual declarations.');
  });

  it('gives a bilingual glossary: each term in English and Swahili', () => {
    render(<AboutView language="en" apiBase={API} />);

    const glossary = screen.getByRole('region', { name: 'Definitions' });
    const term = within(glossary).getByText('Compliance rate').closest('dt');
    expect(term?.textContent).toContain('Kiwango cha utiifu');
    expect(within(glossary).getByText(/Compliant determinations as a share/)).toBeTruthy();
  });

  it('documents every table’s columns in English and Swahili, the marker included', () => {
    render(<AboutView language="en" apiBase={API} />);

    const columns = screen.getByRole('region', { name: 'Tables and columns' });
    for (const table of [
      'filing-by-commission',
      'compliance-by-commission',
      'by-entity-type',
      'by-cycle',
      'access-requests',
      'national-totals',
    ]) {
      expect(within(columns).getByText(table)).toBeTruthy();
    }
    const filing = within(columns).getByText('filing-by-commission').closest('details');
    if (!filing) throw new Error('no filing-by-commission details');
    const rate = within(filing).getByText('filingRate').closest('tr');
    expect(rate?.textContent).toContain('Declaration rate');
    expect(rate?.textContent).toContain('Kiwango cha matamko');
    expect(within(filing).getByText('_suppressed')).toBeTruthy();
  });

  it('lists the public API with its base URL and a CSV example', () => {
    render(<AboutView language="en" apiBase={API} />);

    const api = screen.getByRole('region', { name: 'API' });
    expect(
      within(api).getByText('/releases/{fy}/{kind}/{version}/tables/{table}.csv'),
    ).toBeTruthy();
    expect(api.textContent).toContain(
      `curl ${API}/releases/2025/annual/1/tables/filing-by-commission.csv`,
    );
    expect(api.textContent).toContain('Too many requests get a 429');
  });

  it('reads in Swahili', () => {
    render(<AboutView language="sw" apiBase={API} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kuhusu data hii' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Faragha' })).toBeTruthy();
    expect(screen.getByText(/Maamuzi ya utiifu kama sehemu/)).toBeTruthy();
  });
});
