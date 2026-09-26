import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type EmptyStateProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** Decorative icon, e.g. a lucide-react icon. Hidden from assistive technology. */
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  /** Optional call to action, e.g. a `Button`. */
  action?: ReactNode;
};

export function EmptyState({ icon, title, text, action, className, ...props }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-4 py-10 text-center', className)} {...props}>
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-4 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-[15px] leading-6 font-semibold tracking-tight">{title}</h3>
      {text ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
