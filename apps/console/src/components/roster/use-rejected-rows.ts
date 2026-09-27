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

const firstPage: PageLocation = { search: {}, state: { trail: [], offset: 0 } };

const unavailable = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

/**
 * An import's rejected rows, a page at a time with Previous and Next. The page on show lives in
 * component state (the report shows one import; its rows are a section of the page), and each
 * page is read when it is asked for. `initial`, when given, is the first page as the route's
 * loader read it. Pass `importId: null` to read nothing (no rows to show).
 */
export function useRejectedRows(
  importId: string | null,
  deps: RejectedRowsDeps,
  initial?: DirectoryResult<RosterImportRowPage>,
) {
  const [location, setLocation] = useState<PageLocation>(firstPage);
  const [round, setRound] = useState(0);
  const cursor = location.search.cursor;
  const key = `${importId}:${cursor ?? ''}:${String(round)}`;
  const firstKey = `${importId}::0`;
  const [found, setFound] = useState<{
    key: string;
    result: DirectoryResult<RosterImportRowPage>;
  } | null>(initial ? { key: firstKey, result: initial } : null);
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

  const paging = { trail: location.state.trail, offset: location.state.offset };
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
      if (to) setLocation(to);
    },
    previous: () => {
      setLocation(previousPage<CursorSearch>(location.search, paging));
    },
    retry: () => {
      setRound((current) => current + 1);
    },
  };
}
