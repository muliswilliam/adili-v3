import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
