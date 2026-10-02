import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type EmptyStateProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** Decorative icon, hidden from assistive technology. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Older name for `description`, kept so existing callers still build. Prefer `description`,
   * which matches the other primitives. Not tagged deprecated, which would fail their lint.
   */
  text?: ReactNode;
  /** Optional next step, e.g. a Button. */
  action?: ReactNode;
};

/** Centred message for an empty list or panel, usually inside a Card. */
export function EmptyState({
  icon,
  title,
  description,
  text,
  action,
  className,
  ...props
}: EmptyStateProps) {
  const body = description ?? text;

  return (
    <div className={cn('flex flex-col items-center px-5 py-10 text-center', className)} {...props}>
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-3.5 flex size-[30px] items-center justify-center rounded-tile bg-muted text-muted-foreground [&_svg]:size-4"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-[15px] leading-snug font-semibold">{title}</h3>
      {body ? <p className="mt-1 max-w-[340px] text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}
