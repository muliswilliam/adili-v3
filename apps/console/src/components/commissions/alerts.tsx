import { Alert, AlertDescription, AlertTitle, Button, Icon } from '@adili/ui';
import { AlertCircleIcon, RefreshIcon, SquareLock02Icon } from '@hugeicons/core-free-icons';

import type { DirectoryFailure } from '../../server/directory/result';
import { failureText, messages } from './messages';

/** The directory refused the caller (403). */
export function ForbiddenAlert() {
  return (
    <Alert role="status">
      <Icon icon={SquareLock02Icon} />
      <AlertTitle>{messages.forbidden}</AlertTitle>
    </Alert>
  );
}

/** A directory call failed: the directory's explanation when it gave one, and Try again. */
export function LoadErrorAlert({
  title,
  failure,
  onRetry,
}: {
  title: string;
  failure: DirectoryFailure;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2.5">
        <p>{failureText(failure)}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <Icon icon={RefreshIcon} />
          {messages.error.retry}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
