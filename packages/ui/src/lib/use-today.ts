import { useEffect, useState } from 'react';

import { formatCalendarDate, msUntilKenyanMidnight } from './format-date';

/**
 * Now in epoch milliseconds, or `fixed` when given, for text that counts calendar days. Re-read
 * after hydration (the server may have rendered on the other side of midnight) and at each
 * Kenyan midnight, so a page left open moves on a day. Only a new calendar day changes the
 * value, so it does not re-render otherwise.
 */
export function useToday(fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const refresh = () => {
      setNow((previous) => {
        const current = Date.now();
        return formatCalendarDate(current) === formatCalendarDate(previous) ? previous : current;
      });
    };
    const afterHydration = setTimeout(refresh, 0);
    const atMidnight = setTimeout(refresh, msUntilKenyanMidnight(Date.now()) + 1000);
    return () => {
      clearTimeout(afterHydration);
      clearTimeout(atMidnight);
    };
  }, [fixed, now]);
  return fixed ?? now;
}
