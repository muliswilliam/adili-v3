import { Alert, AlertDescription, AlertTitle, Button } from '@adili/ui';
import { useRouter } from '@tanstack/react-router';
import { CircleAlert, Lock, RefreshCw } from 'lucide-react';
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
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
      <div className="mt-2">
        <Button variant="outline" size="sm" onClick={() => void router.invalidate()}>
          <RefreshCw aria-hidden="true" />
          {retryLabel}
        </Button>
      </div>
    </Alert>
  );
}

/** The directory refused the viewer (403). Retrying will not help. */
export function NoAccess({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <Alert role="status">
      <Lock aria-hidden="true" />
      <AlertTitle>{text}</AlertTitle>
      {action ? <div className="mt-2">{action}</div> : null}
    </Alert>
  );
}
