import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type EmptyStateProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** Decorative icon, hidden from assistive technology. */
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  /** Optional next step, e.g. a Button. */
  action?: ReactNode;
};

export function EmptyState({ icon, title, text, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <div className="grid max-w-sm gap-1">
        <h3 className="text-base leading-6 font-semibold tracking-tight">{title}</h3>
        {text ? <p className="text-sm text-muted-foreground">{text}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
