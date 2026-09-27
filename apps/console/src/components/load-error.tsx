import { Alert, AlertDescription, AlertTitle, Button, Card, EmptyState, Icon } from '@adili/ui';
import { AlertCircleIcon, RefreshIcon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** A load that failed and may work if retried (network, timeout, 5xx). Retry reruns loaders. */
export function LoadError({
  title,
  detail,
  retryLabel,
}: {
  title: string;
  detail: string;
  retryLabel: string;
}) {
  const router = useRouter();
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2.5">
        <p>{detail}</p>
        <Button variant="secondary" size="sm" onClick={() => void router.invalidate()}>
          <Icon icon={RefreshIcon} />
          {retryLabel}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** The directory refused the viewer (403), or the workspace is not theirs. Retrying will not help. */
export function NoAccess({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <Alert role="status">
      <Icon icon={SquareLock02Icon} />
      <AlertTitle>{text}</AlertTitle>
      {action ? <div className="mt-2">{action}</div> : null}
    </Alert>
  );
}

/** A signed-in account with no console role at all. */
export function NoStaffRoles({ inCard = true }: { inCard?: boolean }) {
  const state = (
    <EmptyState
      icon={<Icon icon={SquareLock02Icon} />}
      title="No staff roles"
      description="Your account has no console access. Declarants file through the portal."
    />
  );
  return inCard ? <Card className="p-0 sm:p-0">{state}</Card> : state;
}
