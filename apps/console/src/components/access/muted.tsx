import type { ReactNode } from 'react';

/** Text on a muted panel: where a step stands, or nothing yet. */
export function Muted({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground">
      {children}
    </div>
  );
}
