import { useEffect, useEffectEvent, useState } from 'react';

/**
 * Loads an obligation's detail (its reminder history) for a drawer: `load(id)` runs when `id`
 * is set or changes, and again on `retry`. `detail` is null while loading (or with no id); a
 * rejected load settles as `failed`. A reply for an id no longer shown is dropped. The app
 * passes its own server function as `load` and its own result type as `T`.
 */
export function useObligationDetail<T>(
  id: string | null,
  load: (id: string) => Promise<T>,
  failed: T,
): { detail: T | null; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; result: T } | null>(null);
  const key = id === null ? null : `${id}:${String(attempt)}`;
  const read = useEffectEvent((at: string) => load(at));
  const failure = useEffectEvent(() => failed);

  useEffect(() => {
    if (id === null || key === null) return;
    let current = true;
    read(id).then(
      (result) => {
        if (current) setLoaded({ key, result });
      },
      () => {
        if (current) setLoaded({ key, result: failure() });
      },
    );
    return () => {
      current = false;
    };
  }, [id, key]);

  return {
    detail: loaded !== null && loaded.key === key ? loaded.result : null,
    retry: () => {
      setAttempt((count) => count + 1);
    },
  };
}
