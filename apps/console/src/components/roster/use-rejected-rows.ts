import { useEffect, useEffectEvent, useState } from 'react';

import type { DirectoryResult, RosterImportRowPage } from '../../server/directory/client';
import {
  type CursorSearch,
  nextPage,
  type PageLocation,
  pagingView,
  type PagingView,
  previousPage,
} from '../paging';
import { type RowsFailure, rowsFailure } from './import-report';

export type RejectedRowsView =
  | { phase: 'loading' }
  | { phase: 'failed'; failure: RowsFailure }
  | { phase: 'ready'; page: RosterImportRowPage; paging: PagingView };

export interface RejectedRowsDeps {
  /** Reads one page of the import's rejected rows; a server function in the app. */
  read: (cursor: string | undefined) => Promise<DirectoryResult<RosterImportRowPage>>;
  onUnauthenticated: () => void;
}

/**
 * Where the page on show is kept when not in the hook's own state: the report page keeps its
 * cursor in the URL and the way back in history state, like the other paged lists.
 */
export interface RejectedRowsPager {
  location: PageLocation;
  go: (to: PageLocation) => void;
}

export interface RejectedRowsOptions {
  /** The page at the pager's (or the first) location, as the route's loader read it. */
  initial?: DirectoryResult<RosterImportRowPage>;
  pager?: RejectedRowsPager;
}

const firstPage: PageLocation = { search: {}, state: { trail: [], offset: 0 } };

const unavailable = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

/**
 * An import's rejected rows, a page at a time with Previous and Next; each page is read when it
 * is asked for. The page on show lives in `options.pager` when given, otherwise in component
 * state, where another import starts again at its first page. Pass `importId: null` to read
 * nothing (no rows to show).
 */
export function useRejectedRows(
  importId: string | null,
  deps: RejectedRowsDeps,
  { initial, pager }: RejectedRowsOptions = {},
) {
  const [own, setOwn] = useState({ importId, location: firstPage });
  const location = pager ? pager.location : own.importId === importId ? own.location : firstPage;
  const go = (to: PageLocation) => {
    if (pager) pager.go(to);
    else setOwn({ importId, location: to });
  };
  const [round, setRound] = useState(0);
  const cursor = location.search.cursor;
  const key = `${importId}:${cursor ?? ''}:${String(round)}`;
  const [found, setFound] = useState<{
    key: string;
    result: DirectoryResult<RosterImportRowPage>;
  } | null>(() => (initial ? { key, result: initial } : null));
  const result = found?.key === key ? found.result : null;

  const read = useEffectEvent((at: string | undefined) => deps.read(at));
  const unauthenticated = useEffectEvent(() => {
    deps.onUnauthenticated();
  });

  const loaded = result !== null;
  useEffect(() => {
    if (loaded || importId === null) return;
    let stopped = false;
    void read(cursor)
      .catch(() => unavailable)
      .then((answer) => {
        if (stopped) return;
        if (!answer.ok && answer.error.kind === 'unauthenticated') {
          unauthenticated();
          return;
        }
        setFound({ key, result: answer });
      });
    return () => {
      stopped = true;
    };
  }, [key, cursor, loaded, importId]);

  const paging = location.state;
  const view: RejectedRowsView =
    result === null
      ? { phase: 'loading' }
      : result.ok
        ? { phase: 'ready', page: result.data, paging: pagingView(result.data, paging) }
        : { phase: 'failed', failure: rowsFailure(result.error) };

  return {
    view,
    next: () => {
      if (!result?.ok) return;
      const to = nextPage<CursorSearch>(location.search, result.data, paging);
      if (to) go(to);
    },
    previous: () => {
      go(previousPage<CursorSearch>(location.search, paging));
    },
    retry: () => {
      setRound((current) => current + 1);
    },
  };
}
