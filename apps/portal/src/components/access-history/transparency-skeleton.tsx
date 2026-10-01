import { Card, Skeleton } from '@adili/ui';

/** The transparency pages while they load: a few rows' worth of placeholders. */
export function TransparencySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="grid gap-4">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full" />
        <Skeleton className="h-8 w-36 rounded-full" />
      </div>
      <Card className="grid gap-5 p-5 sm:p-6">
        {[80, 60, 70, 45].map((width) => (
          <div key={width} className="flex items-start gap-3.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4" style={{ width: `${String(width)}%` }} />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
