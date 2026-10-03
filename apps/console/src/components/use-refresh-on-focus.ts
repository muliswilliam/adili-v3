import { useEffect, useEffectEvent } from 'react';

/**
 * Calls `refresh` each time the window regains focus, e.g. to read counts again when someone
 * comes back to the tab after the declarations behind them moved on.
 */
export function useRefreshOnFocus(refresh: () => void): void {
  const onFocus = useEffectEvent(refresh);
  useEffect(() => {
    const listener = () => {
      onFocus();
    };
    window.addEventListener('focus', listener);
    return () => {
      window.removeEventListener('focus', listener);
    };
  }, []);
}
