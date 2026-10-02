import { cn, type Scope } from '@adili/ui';
import type { ReactNode } from 'react';

import { FORM_K_COPY as COPY } from '../../access/copy';
import { scopeChips } from '../../access/format';

/** Rows of a term and its value, the term in a narrow column from `sm`. */
export function PartRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2.5 sm:grid-cols-[168px_minmax(0,1fr)]', className)}>
      {children}
    </dl>
  );
}

export function PartRow({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:col-span-2 sm:grid-cols-subgrid sm:gap-0">
      <dt className="text-[13.5px] text-muted-foreground sm:pt-px">{term}</dt>
      <dd className="text-[14.5px] break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

function Chips({ values }: { values: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <li
          key={value}
          className="rounded-md bg-muted px-2 py-0.5 text-[13px] font-medium text-secondary-foreground"
        >
          {value}
        </li>
      ))}
    </ul>
  );
}

/** A Form K scope as rows of chips: years, people and sections. */
export function ScopeRows({ scope }: { scope: Scope }) {
  const chips = scopeChips(scope);
  return (
    <PartRows className="items-center">
      <PartRow term={COPY.years}>
        <Chips values={chips.years} />
      </PartRow>
      <PartRow term={COPY.people}>
        <Chips values={chips.people} />
      </PartRow>
      <PartRow term={COPY.sections}>
        <Chips values={chips.sections} />
      </PartRow>
    </PartRows>
  );
}
