import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';

export const buttonVariants = cva(
  [
    focusRing,
    'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background-color,box-shadow,color,transform] select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      // The prototype kit's .btn-primary, -secondary, -ghost, -danger, -danger-ghost and .link.
      variant: {
        default:
          'bg-primary bg-linear-to-b from-white/8 to-black/8 text-primary-foreground shadow-button-primary hover:from-white/14 disabled:bg-primary-disabled disabled:bg-none disabled:text-primary-disabled-foreground disabled:opacity-100 disabled:shadow-none',
        secondary: 'bg-card text-foreground shadow-control hover:bg-muted',
        ghost: 'text-secondary-foreground hover:bg-muted hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground shadow-button-destructive hover:bg-destructive-hover',
        'destructive-ghost': 'text-destructive hover:bg-destructive-subtle',
        // The prototype kit's .btn-ai: an action that asks an AI model for something.
        ai: 'bg-ai text-ai-foreground hover:bg-[color-mix(in_oklch,var(--ai),black_12%)]',
        link: 'text-foreground underline decoration-input underline-offset-3 hover:decoration-foreground active:translate-y-0',
      },
      size: {
        xs: 'h-7 rounded-[7px] px-2.5 text-[13px] [&_svg]:size-3.5',
        sm: 'h-[34px] rounded-md px-3 text-sm [&_svg]:size-4',
        default: 'h-11 rounded-lg px-[18px] text-[15px] [&_svg]:size-[18px]',
        icon: 'size-9 rounded-md [&_svg]:size-[18px]',
      },
    },
    // Links sit inline with text, so they drop the size's height and padding.
    compoundVariants: [{ variant: 'link', className: 'h-auto rounded-sm px-0' }],
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
