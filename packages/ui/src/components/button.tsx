import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm leading-4 whitespace-nowrap transition-[background-color,box-shadow] outline-none select-none disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      // Primary, secondary, ghost and destructive follow the style guide; outline is a
      // quieter secondary for toolbars and headers.
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-button-primary hover:bg-primary-hover hover:shadow-button-primary-hover focus-visible:bg-primary-hover focus-visible:shadow-button-primary-focus',
        secondary:
          'bg-secondary text-secondary-foreground shadow-button-secondary hover:bg-secondary-hover focus-visible:bg-secondary-hover focus-visible:shadow-button-secondary-focus',
        outline:
          'bg-card text-foreground shadow-control hover:shadow-control-hover focus-visible:shadow-control-focus',
        ghost:
          'text-foreground hover:bg-secondary-hover focus-visible:bg-secondary-hover focus-visible:shadow-button-secondary-focus',
        destructive:
          'bg-destructive text-destructive-foreground shadow-button-destructive hover:bg-destructive-hover focus-visible:bg-destructive-hover focus-visible:shadow-button-destructive-focus',
        link: 'rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring',
      },
      size: {
        sm: 'h-7 px-2.5 text-[13px]',
        default: 'h-8 px-3',
        lg: 'h-10 px-4',
        icon: 'size-8',
      },
    },
    // Links sit inline with text, so they drop the size padding.
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. a link) with button styles. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
