import { useEffect, useState } from 'react';

import { followsEarlierDeclaration, type ObligationType } from '../../declaration/contents';
import { getPreviousDeclaration } from '../../server/declarations';
import type { PreviousDeclaration } from '../../server/declarations.server';

/**
 * The declarant's previous filed declaration, to compare the draft with while filing (ADR-006
 * point 10). Read once per draft and visit: it was filed, so it does not change while this one
 * is. An initial declaration follows none and asks nothing of changes, so it is not read.
 */
export type PreviousLoad =
  | { status: 'loading' }
  | { status: 'ready'; previous: PreviousDeclaration }
  /** A first declaration, or an initial one. */
  | { status: 'none' }
  | { status: 'unavailable' };

const loaded = new Map<string, Promise<PreviousLoad>>();

/** Forgets what was read (tests). */
export function resetPreviousDeclarations() {
  loaded.clear();
}

function load(declarationId: string): Promise<PreviousLoad> {
  let found = loaded.get(declarationId);
  if (!found) {
    found = getPreviousDeclaration({ data: { declarationId } }).then(
      (result): PreviousLoad => {
        if (result.status !== 'ok') return { status: 'unavailable' };
        return result.previous
          ? { status: 'ready', previous: result.previous }
          : { status: 'none' };
      },
      (): PreviousLoad => ({ status: 'unavailable' }),
    );
    // A failed read is asked again on the next visit to a screen that shows it.
    void found.then((result) => {
      if (result.status === 'unavailable') loaded.delete(declarationId);
    });
    loaded.set(declarationId, found);
  }
  return found;
}

export function usePreviousDeclaration(declarationId: string, type: ObligationType): PreviousLoad {
  const asked = followsEarlierDeclaration(type);
  const [settled, setSettled] = useState<{ id: string; load: PreviousLoad } | null>(null);

  useEffect(() => {
    if (!asked) return;
    let current = true;
    void load(declarationId).then((result) => {
      if (current) setSettled({ id: declarationId, load: result });
    });
    return () => {
      current = false;
    };
  }, [asked, declarationId]);

  if (!asked) return { status: 'none' };
  return settled?.id === declarationId ? settled.load : { status: 'loading' };
}
