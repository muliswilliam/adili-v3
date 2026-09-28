import { Alert, AlertDescription, AlertTitle, Icon, type IconProps } from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

/**
 * Why a wizard step cannot go on, and what to do about it: a destructive alert with a title, an
 * optional explanation and the way out as buttons under it.
 */
export function ProblemAlert({
  icon = AlertCircleIcon,
  title,
  text,
  children,
}: {
  icon?: IconProps['icon'];
  title: string;
  text?: ReactNode;
  /** The actions, e.g. "Try again" or "Upload again". */
  children?: ReactNode;
}) {
  return (
    <Alert variant="destructive">
      <Icon icon={icon} />
      <AlertTitle>{title}</AlertTitle>
      {text ? <AlertDescription>{text}</AlertDescription> : null}
      {children ? <div className="mt-2.5 flex flex-wrap gap-2">{children}</div> : null}
    </Alert>
  );
}
