import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { controlClassName } from './input';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        controlClassName,
        'flex min-h-[110px] resize-y px-3 py-2.5 leading-normal',
        className,
      )}
      {...props}
    />
  );
}
