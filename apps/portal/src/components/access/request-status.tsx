import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Icon,
  IconTile,
} from '@adili/ui';
import { AlertCircleIcon, UserAccountIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { REQUESTS_COPY, STATUSES } from '../../access/copy';
import type { AccessRequestStatus } from '../../server/access/types';

/** A request's status as a badge: its word and icon, in the status's tone. */
export function RequestStatusBadge({
  status,
  className,
}: {
  status: AccessRequestStatus;
  className?: string;
}) {
  const meta = STATUSES[status];
  return (
    <Badge variant={meta.tone} data-status={status} className={className}>
      <Icon icon={meta.icon} strokeWidth={2.2} />
      {meta.label.en}
    </Badge>
  );
}

/** The status's icon on a tile in its tone, leading a row of My requests. */
export function RequestStatusTile({ status }: { status: AccessRequestStatus }) {
  const meta = STATUSES[status];
  return (
    <IconTile tone={meta.tone} aria-hidden="true">
      <Icon icon={meta.icon} />
    </IconTile>
  );
}

/** The account cannot request access: it has no applicant record. */
export function NotApplicantNotice({ className }: { className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <EmptyState
        icon={<Icon icon={UserAccountIcon} />}
        title={REQUESTS_COPY.notApplicantTitle}
        description={REQUESTS_COPY.notApplicantText}
        action={
          <Button asChild variant="secondary">
            <Link to="/access/get-started">{REQUESTS_COPY.getStarted}</Link>
          </Button>
        }
      />
    </Card>
  );
}

/** The service could not be reached. */
export function UnavailableNotice({ title, text }: { title: string; text: string }) {
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
