import { Skeleton } from '@adili/ui';

import { Page } from '../../page';

const MAIN_LINES = ['60%', '90%', '75%', '85%', '50%', '95%', '70%', '80%'];
const SIDE_LINES = ['40%', '90%', '80%', '95%', '60%', '85%'];

/** The case view while the case and its declaration load. */
export function CaseViewSkeleton() {
  return (
    <Page aria-busy="true" aria-label="Loading the case">
      <div className="mb-[18px] grid gap-3.5">
        <Skeleton className="h-7 w-[220px] rounded-lg" />
        <Skeleton className="h-[26px] w-[340px] max-w-full rounded-md" />
        <Skeleton className="w-[520px] max-w-full" />
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_460px]">
        <div className="grid gap-[14px] rounded-2xl bg-card p-5 shadow-card">
          {MAIN_LINES.map((width, index) => (
            <Skeleton key={index} style={{ width }} />
          ))}
        </div>
        <div className="grid content-start gap-[14px] rounded-2xl bg-card p-5 shadow-card">
          {SIDE_LINES.map((width, index) => (
            <Skeleton key={index} style={{ width }} />
          ))}
        </div>
      </div>
    </Page>
  );
}
