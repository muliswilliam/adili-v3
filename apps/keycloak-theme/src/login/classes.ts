import type { ClassKey } from 'keycloakify/login';

import { buttonVariants, cn, controlClassName } from '@adili/ui';

/** Same edges, height and states as the design system's Input. */
const input = cn(controlClassName, 'flex h-11 px-3');

/**
 * Tailwind classes for the pages rendered by Keycloakify's DefaultPage (everything this theme does
 * not render itself in pages/), so rarely seen flows match the design system.
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
  kcButtonClass: buttonVariants(),
  kcButtonPrimaryClass: buttonVariants({ variant: 'default' }),
  kcButtonDefaultClass: buttonVariants({ variant: 'secondary' }),
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
