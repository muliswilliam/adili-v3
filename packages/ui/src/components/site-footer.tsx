import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export function SiteFooter({ className, children, ...props }: ComponentProps<'footer'>) {
  return (
    <footer className={cn('border-t', className)} {...props}>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Adili Online DIALs. Conflict of Interest Act, 2025 and Regulations, 2026.</p>
        {children}
      </div>
    </footer>
  );
}
