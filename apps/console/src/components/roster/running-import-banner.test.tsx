// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RosterImport } from '../../server/directory/client';
import { RunningImportBanner, runningImportText } from './running-import-banner';

// The banner links to the import; a plain anchor stands in for the router's Link.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (href, [name, value]) => href.replace(`$${name}`, value),
        to,
      )}
    >
      {children}
    </a>
  ),
}));

const running: RosterImport = {
  id: '0199a0b4-0000-7000-8000-0000000000aa',
  channel: 'file',
  declaredComplete: true,
  state: 'processing',
  fileName: 'psc-roster.xlsx',
  format: 'xlsx',
  totalRows: 48_431,
  processedRows: 21_400,
  counts: null,
  mapping: null,
  failure: null,
  startedBy: { kind: 'user', id: 'user-1', name: 'Grace Muthoni' },
  startedAt: '2026-09-26T07:40:00Z',
  completedAt: null,
  rowsRetainedUntil: null,
};

describe('RunningImportBanner', () => {
  it('says how far the running import got and links to it', () => {
    render(<RunningImportBanner imp={running} />);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('An import is running: 21,400 of 48,431 rows');
    expect(screen.getByRole('link', { name: 'View import' }).getAttribute('href')).toBe(
      `/roster/imports/${running.id}`,
    );
  });

  it('says the file is being read while the rows are not known yet', () => {
    expect(runningImportText({ state: 'pending', totalRows: null, processedRows: 0 })).toBe(
      'An import is running: reading the file',
    );
  });
});
