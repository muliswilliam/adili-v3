import { Skeleton } from '@adili/ui';

import { verifyMessages as copy } from '../copy';

/**
 * The result page while the lookup is on its way. Its own module: the route loads it up front
 * as its pending component, and the result view with it would come too.
 */
export function ResultSkeleton() {
  return (
    <div role="status" aria-busy="true" className="grid gap-[18px]">
      <span className="sr-only">{copy.loading}</span>
      <div className="grid gap-2.5">
        <Skeleton className="w-[120px]" />
        <Skeleton className="h-[18px] w-[78%]" />
      </div>
      <div className="rounded-2xl bg-card shadow-card">
        <div className="flex gap-3.5 p-5 sm:px-6 sm:py-[22px]">
          <Skeleton className="size-12 rounded-item" />
          <div className="grid flex-1 content-start gap-3">
            <Skeleton className="h-[18px] w-[70%]" />
            <Skeleton className="w-[90%]" />
          </div>
        </div>
        <div className="divide-y px-5 pb-5 sm:px-6">
          {['w-[60%]', 'w-[45%]', 'w-[70%]', 'w-[30%]', 'w-1/2'].map((width) => (
            <div key={width} className="flex justify-between gap-4 py-[13px]">
              <Skeleton className="w-[28%]" />
              <Skeleton className={width} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
