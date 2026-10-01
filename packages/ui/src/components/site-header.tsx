import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Logo } from './logo';

export type SiteHeaderProps = ComponentProps<'header'> & {
  product?: string;
  /** Where the logo links to. */
  homeHref?: string;
  /** Navigation beside the logo, e.g. a `nav` of the area's pages. */
  nav?: ReactNode;
  /** Right-hand actions, e.g. the signed-in user and a sign-out button. */
  actions?: ReactNode;
};

export function SiteHeader({
  product,
  homeHref = '/',
  nav,
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
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <a href={homeHref} className={cn(focusRing, '-mx-1.5 shrink-0 rounded-md px-1.5 py-1')}>
            <Logo product={product} />
          </a>
          {nav}
        </div>
        {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
