import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Logo } from './logo';

export type SiteHeaderProps = ComponentProps<'header'> & {
  product?: string;
  /** Where the logo links to. */
  homeHref?: string;
  /** Right-hand actions, e.g. the signed-in user and a sign-out button. */
  actions?: ReactNode;
};

export function SiteHeader({
  product,
  homeHref = '/',
  actions,
  className,
  ...props
}: SiteHeaderProps) {
  return (
    <header
      className={cn('sticky top-0 z-20 border-b bg-background/85 backdrop-blur-md', className)}
      {...props}
    >
      <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-7">
        <a
          href={homeHref}
          className="-mx-1.5 rounded-md px-1.5 py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Logo product={product} />
        </a>
        {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
