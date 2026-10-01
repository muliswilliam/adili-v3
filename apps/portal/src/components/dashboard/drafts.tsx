import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import type { DeclarationListResult } from '../../server/declarations.server';
import type { DeclarationListItem } from '../../server/declarations/types';

/**
 * The declarant's declarations as the obligations see them, to continue a draft rather than start
 * another: still loading, loaded, or not available.
 */
export type DraftsState =
  | { status: 'pending' }
  | { status: 'ok'; declarations: readonly DeclarationListItem[] }
  | { status: 'unavailable' };

/** No declarations to look at (not an onboarded declarant, or tests): nothing to continue. */
const NONE: DraftsState = { status: 'ok', declarations: [] };

const DraftsContext = createContext<DraftsState>(NONE);

/**
 * Gives the obligations below the declarations `declarations` resolves to, without waiting for
 * them: the obligations render at once and read `pending` until the list arrives. Null when the
 * viewer has no declarations to look at.
 */
export function DraftsProvider({
  declarations,
  children,
}: {
  declarations: Promise<DeclarationListResult> | null;
  children: ReactNode;
}) {
  const [settled, setSettled] = useState<{
    from: Promise<DeclarationListResult>;
    result: DeclarationListResult;
  } | null>(null);
  useEffect(() => {
    if (!declarations) return;
    let current = true;
    void declarations.then(
      (result) => {
        if (current) setSettled({ from: declarations, result });
      },
      () => {
        if (current) setSettled({ from: declarations, result: { status: 'unavailable' } });
      },
    );
    return () => {
      current = false;
    };
  }, [declarations]);

  const state: DraftsState = !declarations
    ? NONE
    : settled?.from !== declarations
      ? { status: 'pending' }
      : settled.result.status === 'ok'
        ? { status: 'ok', declarations: settled.result.declarations }
        : { status: 'unavailable' };
  return <DraftsContext value={state}>{children}</DraftsContext>;
}

/** The declarant's declarations, from the nearest `DraftsProvider`. */
export function useDrafts(): DraftsState {
  return useContext(DraftsContext);
}
