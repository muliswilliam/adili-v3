import type { ReactNode } from 'react';

/** A labelled value in a `dl`: the label small and muted above, the value under it. */
export function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
