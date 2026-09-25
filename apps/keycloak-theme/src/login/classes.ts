import type { ClassKey } from 'keycloakify/login';

import { buttonVariants } from '@adili/ui';

const input =
  'flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive';

/**
 * Tailwind classes for the pages rendered by Keycloakify's DefaultPage (everything except the
 * custom login page), so rarely seen flows (OTP, password update, errors) match the design system.
 */
export const classes = {
  kcFormClass: 'grid gap-5',
  kcFormGroupClass: 'grid gap-2',
  kcLabelWrapperClass: 'grid gap-1',
  kcLabelClass: 'text-sm font-medium',
  kcInputWrapperClass: 'grid gap-1.5',
  kcInputClass: input,
  kcInputGroup: 'relative flex items-center [&>input]:pr-10',
  kcInputErrorMessageClass: 'text-sm text-destructive-subtle-foreground',
  kcInputHelperTextBeforeClass: 'text-sm text-muted-foreground',
  kcInputHelperTextAfterClass: 'text-sm text-muted-foreground',
  kcFormOptionsWrapperClass: 'text-sm',
  kcFormSettingClass: 'text-sm',
  kcFormButtonsClass: 'grid gap-3 pt-1 [&>input]:w-full [&>button]:w-full',
  kcButtonClass: buttonVariants({ size: 'lg' }),
  kcButtonPrimaryClass: buttonVariants({ variant: 'default', size: 'lg' }),
  kcButtonDefaultClass: buttonVariants({ variant: 'outline', size: 'lg' }),
  kcButtonBlockClass: 'w-full',
  kcButtonLargeClass: '',
  kcCheckboxInputClass: 'size-4 rounded border-input',
  kcAlertClass: 'rounded-lg border px-4 py-3 text-sm',
  kcSelectAuthListClass: 'grid gap-2',
  kcSelectAuthListItemClass:
    'flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted',
  kcSelectAuthListItemHeadingClass: 'text-sm font-medium',
  kcSelectAuthListItemDescriptionClass: 'text-sm text-muted-foreground',
  kcRecoveryCodesWarning: 'rounded-lg bg-warning-subtle p-4 text-sm text-warning-subtle-foreground',
} satisfies Partial<Record<ClassKey, string>>;
