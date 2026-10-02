import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueuePage } from './queue-page';

const router = vi.hoisted(() => ({
  hydrated: false,
  location: { state: { reviewQueueSearch: 'Kamau' }, searchStr: '' },
}));

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useRouteContext: () => ({
      viewer: {
        directory: { ok: true, principal: { tenant: 'psc' } },
        user: { subject: 'reviewer-a', name: 'Reviewer A' },
      },
      supervisor: false,
    }),
  }),
  useHydrated: () => router.hydrated,
  useLocation: ({ select }: { select: (location: typeof router.location) => unknown }) =>
    select(router.location),
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => '/review',
}));
vi.mock('../../../server/review-case', () => ({ getReviewers: vi.fn() }));
vi.mock('../../../server/review-queue', () => ({ getReviewQueue: vi.fn() }));
vi.mock('../../reload-in-place', () => ({ useReloadingInPlace: () => false }));
vi.mock('./queue-view', () => ({
  QueueView: ({ list }: { list: unknown }) => (
    <div data-list={list === null ? 'loading' : 'shown'} />
  ),
}));

const page = (loadedFor: string) => (
  <QueuePage
    queue={{
      summary: { ok: false, error: { kind: 'unavailable', detail: null } },
      commission: null,
    }}
    list={{ loadedFor, list: { ok: true, data: { items: [], nextCursor: null } } }}
  />
);

describe('QueuePage', () => {
  beforeEach(() => {
    router.hydrated = false;
  });

  it('Q13: renders the list as loading on the server, which cannot see the search in history', () => {
    // The server loaded the list without the search text the history entry holds.
    expect(renderToString(page('\n'))).toContain('data-list="loading"');
  });

  it('shows the list once hydrated and loaded for the search on show', () => {
    router.hydrated = true;
    expect(renderToString(page('\nKamau'))).toContain('data-list="shown"');
  });
});
