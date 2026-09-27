import { cn } from '../lib/cn';

/** A spinner in the current text colour, for busy buttons and "Checking" lines. Decorative. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-[18px] shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current motion-reduce:animate-none',
        className,
      )}
    />
  );
}
