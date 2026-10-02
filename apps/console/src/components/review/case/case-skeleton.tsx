import { Skeleton } from '@adili/ui';

import { Page } from '../../page';

const DECLARATION = [
  'w-3/5',
  'w-[90%]',
  'w-3/4',
  'w-[85%]',
  'w-1/2',
  'w-[95%]',
  'w-[70%]',
  'w-4/5',
];
const SIDE = ['w-2/5', 'w-[90%]', 'w-4/5', 'w-[95%]', 'w-3/5', 'w-[85%]'];

/** The case view while it loads: the header lines, the declaration card and the review card. */
export function CaseSkeleton() {
  return (
    <Page aria-busy="true">
      <div className="mb-[18px] grid gap-3.5">
        <Skeleton className="h-7 w-[220px]" />
        <Skeleton className="h-[26px] w-[340px] max-w-full" />
        <Skeleton className="w-[520px] max-w-full" />
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_440px]">
        <div className="grid gap-3.5 rounded-2xl bg-card p-5 shadow-card">
          {DECLARATION.map((width, index) => (
            <Skeleton key={index} className={width} />
          ))}
        </div>
        <div className="hidden content-start gap-3.5 rounded-2xl bg-card p-5 shadow-card min-[1100px]:grid">
          {SIDE.map((width, index) => (
            <Skeleton key={index} className={width} />
          ))}
        </div>
      </div>
    </Page>
  );
}
