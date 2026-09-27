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

/** Centred message for an empty list or panel, usually inside a Card. */
export function EmptyState({ icon, title, text, action, className, ...props }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-5 py-10 text-center', className)} {...props}>
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-3.5 flex size-[30px] items-center justify-center rounded-[9px] bg-muted text-muted-foreground [&_svg]:size-4"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-[15px] leading-snug font-semibold">{title}</h3>
      {text ? <p className="mt-1 max-w-[340px] text-sm text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}
