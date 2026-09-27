import { Alert, AlertDescription, Icon, type IconProps } from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

/**
 * A failure or notice on a page that Keycloak just rendered. It takes focus on load, so screen
 * reader users hear why they are back on the page before anything else.
 */
export function PageAlert({
  variant,
  icon,
  children,
  focus = true,
}: {
  variant: 'destructive' | 'warning' | 'info' | 'neutral';
  icon: IconProps['icon'];
  children: ReactNode;
  focus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <Alert ref={ref} tabIndex={-1} variant={variant} className="outline-none">
      <Icon icon={icon} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Help text set apart from the page, e.g. who to contact. Not announced, unlike PageAlert. */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <Alert role="note" variant="neutral">
      <Icon icon={InformationCircleIcon} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
