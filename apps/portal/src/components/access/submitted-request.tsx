import { Alert, AlertDescription, Button, Icon, ReferenceChip, StatusMark } from '@adili/ui';
import { Tick02Icon, UserQuestion01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { day, SUBMITTED_COPY as COPY } from '../../access/copy';
import { accessReferenceParts } from '../../access/reference';
import type { AccessRequest } from '../../server/access/types';

/**
 * The acknowledgement on screen once Form K is filed: the ARQ reference, the day it was
 * received and the 30 days the Commission has to decide; for a passport applicant, that the
 * Commission checks their identity first.
 */
export function SubmittedRequest({ request }: { request: AccessRequest }) {
  const pending = request.status === 'pending-applicant-verification';
  return (
    <div className="flex flex-col items-center text-center">
      <StatusMark icon={Tick02Icon} tone="success" className="mb-4" />
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">{COPY.title}</h1>
      <ReferenceChip
        className="mt-4"
        reference={request.reference}
        parts={accessReferenceParts(request.commission.name)}
        size="lg"
      />
      <p className="mt-4 max-w-[440px] text-pretty text-muted-foreground">
        {COPY.acknowledged(day(request.submittedAt))}
      </p>
      {pending ? (
        <Alert variant="warning" className="mt-5 max-w-[480px] text-left">
          <Icon icon={UserQuestion01Icon} />
          <AlertDescription>{COPY.passport}</AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Button asChild>
          <Link to="/access/requests/$id" params={{ id: request.id }}>
            {COPY.view}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/access/requests" search={{}}>
            {COPY.myRequests}
          </Link>
        </Button>
      </div>
    </div>
  );
}
