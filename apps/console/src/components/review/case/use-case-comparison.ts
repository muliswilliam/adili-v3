import { useCallback, useEffect, useRef, useState } from 'react';

import { comparisonView } from '../../../review-case/compare';
import { getCaseComparison } from '../../../server/review-case';
import type { ComparisonState } from './compare-pane';

/**
 * Compare on the case view: reads the comparison when the reviewer first turns it on (an audited
 * read of both versions, so not with every load of the case) and keeps it while the case shows
 * the same version; a new version processed meanwhile reads it again. Try again after a failure.
 */
export function useCaseComparison(caseId: string, currentVersion: number) {
  const [on, setOn] = useState(false);
  const [state, setState] = useState<ComparisonState | null>(null);
  const [retrying, setRetrying] = useState(false);
  const key = `${caseId}:${String(currentVersion)}`;
  const loadedFor = useRef<string | null>(null);

  const read = useCallback(async () => {
    const result = await getCaseComparison({ data: { caseId } }).catch(() => null);
    if (!result?.ok) {
      // Turning Compare off and on again tries again too.
      loadedFor.current = null;
      setState({ status: 'failed' });
      return;
    }
    setState(
      result.data === null
        ? { status: 'none' }
        : { status: 'ready', view: comparisonView(result.data) },
    );
  }, [caseId]);

  useEffect(() => {
    if (!on || loadedFor.current === key) return;
    loadedFor.current = key;
    setState({ status: 'loading' });
    void read();
  }, [on, key, read]);

  const retry = useCallback(async () => {
    setRetrying(true);
    loadedFor.current = key;
    await read();
    setRetrying(false);
  }, [key, read]);

  return { on, setOn, state: state ?? { status: 'loading' }, retry, retrying } as const;
}
