import { Alert, AlertDescription, Button, Icon } from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import type { Ref } from 'react';

import { GENERIC_ERROR } from './problems';

/** Shown in place of a step when its loader could not read the session. */
export function SessionUnavailable() {
  return (
    <Alert variant="destructive">
      <AlertDescription>{GENERIC_ERROR}</AlertDescription>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-fit"
        onClick={() => {
          window.location.reload();
        }}
      >
        Try again
      </Button>
    </Alert>
  );
}

/** A failed step. Focusable, so the step can move focus to it and screen readers read it. */
export function FailureAlert({
  ref,
  message = GENERIC_ERROR,
}: {
  ref: Ref<HTMLDivElement>;
  message?: string;
}) {
  return (
    <Alert ref={ref} tabIndex={-1} variant="destructive" className="outline-none">
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
