import { cn } from '@adili/ui';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-[18px] shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current',
        className,
      )}
    />
  );
}
