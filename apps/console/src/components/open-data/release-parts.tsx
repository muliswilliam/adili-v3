import { cn } from '@adili/ui';
import type { ComponentProps } from 'react';

import type { OpenDataRelease } from '../../server/reporting/types';
import { messages as m } from './messages';

/** The kit's `.kind` tag: Annual or Snapshot, or "Version 2", on a hairline outline. */
export function KindTag({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-md px-2 text-xs font-medium whitespace-nowrap text-secondary-foreground shadow-card-flat',
        className,
      )}
      {...props}
    />
  );
}

/** "FY 2026/2027 snapshot v1", for links and the breadcrumb. */
export function releaseName(release: Pick<OpenDataRelease, 'fy' | 'kind' | 'version'>): string {
  return m.releaseCrumb(release.fy, release.kind, release.version);
}
