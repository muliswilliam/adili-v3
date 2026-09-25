import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** Adili mark: a shield enclosing a check, drawn to stay crisp from 16px up. */
export function LogoMark({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('size-8 shrink-0', className)}
      {...props}
    >
      <path
        d="M16 2.5 4.5 7v8.2c0 7 4.9 12.4 11.5 14.3 6.6-1.9 11.5-7.3 11.5-14.3V7L16 2.5Z"
        className="fill-primary"
      />
      <path
        d="m10.5 16.2 3.8 3.8 7.4-7.6"
        className="stroke-primary-foreground"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type LogoProps = ComponentProps<'span'> & {
  /** Product area shown after the wordmark, e.g. "Console". */
  product?: string;
};

export function Logo({ product, className, ...props }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} {...props}>
      <LogoMark className="size-7" />
      <span className="flex items-baseline gap-2 leading-none">
        <span className="text-[15px] font-semibold tracking-tight">Adili Online</span>
        {product ? (
          <span className="border-l pl-2 text-[13px] font-medium text-muted-foreground">
            {product}
          </span>
        ) : null}
      </span>
    </span>
  );
}
