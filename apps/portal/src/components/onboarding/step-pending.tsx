import { Alert, AlertDescription, Button } from '@adili/ui';

import type { StepGuard } from './guard';
import { StepHeading } from './onboarding-layout';

/**
 * Stand-in body for steps whose screens come in later tickets (#69, #72). The route and its
 * guard are real, so the flow already lands on the right step.
 */
export function StepPending({ title, guard }: { title: string; guard: StepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  return (
    <div className="grid gap-6">
      <StepHeading title={title} description="This step is not available yet." />
    </div>
  );
}

export function SessionUnavailable() {
  return (
    <Alert variant="destructive">
      <AlertDescription>Something went wrong. Try again.</AlertDescription>
      <Button
        variant="secondary"
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
