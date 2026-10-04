// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MyNoticesLoad } from '../../server/notices';
import { mockNotice, resetReviewMock } from '../../server/review/mock.server';
import { MOCK_NOTICE_IDS as IDS } from '../../server/review/notices-mock.server';
import type { DeclarantNotice } from '../../server/review/types';
import { NoticesSection } from './notices-card';

vi.mock('@tanstack/react-router', () => ({
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
    <a href={to.replace('$actionId', params?.actionId ?? '')} {...props}>
      {children}
    </a>
  ),
}));

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();

function notice(id: string): DeclarantNotice {
  const found = mockNotice(id);
  if (!found) throw new Error(id);
  return found;
}

async function renderWith(load: MyNoticesLoad) {
  const promise = Promise.resolve(load);
  await act(async () => {
    render(<NoticesSection notices={promise} />);
    await promise;
  });
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});
afterEach(cleanup);

describe('Notices card (S17)', () => {
  it('lists the notices still running, with View all', async () => {
    await renderWith({ status: 'ok', notices: Object.values(IDS).map(notice), now: NOW });
    const card = screen.getByRole('region', { name: 'Notices' });
    expect(
      within(card)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/notices', `/notices/${IDS.warning}`, `/notices/${IDS.noticeOpen}`]);
    expect(within(card).getByRole('link', { name: 'View all notices' })).toBeTruthy();
  });

  it('is not there once every notice has closed, nor when the list could not load', async () => {
    await renderWith({ status: 'ok', notices: [notice(IDS.complied)], now: NOW });
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    cleanup();
    await renderWith({ status: 'unavailable', now: NOW });
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
  });
});
