import {
  Alert,
  AlertDescription,
  AlertTitle,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  type IconProps,
  IconTile,
  type IconTileProps,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

/**
 * The header of a determination or approval dialog (the prototype's `.dlg-h`): an icon tile, the
 * title, and a muted line under it naming what it is about.
 */
export function DialogHeading({
  icon,
  tone,
  title,
  description,
}: {
  icon: IconProps['icon'];
  tone?: IconTileProps['tone'];
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <DialogHeader className="flex-row items-start gap-3">
      <IconTile tone={tone} className="mt-0.5">
        <Icon icon={icon} />
      </IconTile>
      <div className="grid min-w-0 gap-[3px]">
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{title}</DialogDescription>
        )}
      </div>
    </DialogHeader>
  );
}

/** Why a request was refused or failed: a title, what it means, and the problem it answered. */
export interface FailureText {
  title: string;
  detail?: string;
  /** The status and problem code, as the prototype prints them ("409 determination-open"). */
  problem?: string;
}

/** A refused or failed request inside a dialog, in red. */
export function DialogFailure({ failure }: { failure: FailureText | null }) {
  if (!failure) return null;
  return (
    <Alert variant="destructive" role="alert">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{failure.title}</AlertTitle>
      {failure.detail || failure.problem ? (
        <AlertDescription className="grid gap-1">
          {failure.detail ? <p>{failure.detail}</p> : null}
          {failure.problem ? (
            <p className="text-[13px]">
              Problem:{' '}
              <code className="rounded bg-card/60 px-1 font-mono text-[12.5px]">
                {failure.problem}
              </code>
            </p>
          ) : null}
        </AlertDescription>
      ) : null}
    </Alert>
  );
}
